// HTTP/2 session wrapper. One long-lived session per (origin, options) pair;
// auto-reconnect on `goaway` event or socket close; idle timeout after
// `idleTimeoutMs` of no requests.
//
// We intentionally do NOT pool multiple sessions. APNs supports HTTP/2
// multiplexing of many concurrent streams over a single connection — that's
// the whole point of the protocol — so `client.session.request()` returns a
// new stream each call, and Node serializes them onto the wire. Connection
// reuse cuts TLS handshake cost and matches Apple's documented expectations.

import http2 from "node:http2";
import type { ClientHttp2Session, ClientHttp2Stream } from "node:http2";

export interface Http2RequestInit {
  headers: Record<string, string | number>;
  body?: string | Buffer;
  /** Per-request timeout in ms; 0 disables. Default 30_000. */
  timeoutMs?: number;
  /**
   * Optional caller-supplied abort signal. When the signal aborts before the
   * response completes, the request stream is cancelled via `NGHTTP2_CANCEL`
   * and the promise rejects with the signal's reason (or a generic AbortError
   * fallback). An already-aborted signal rejects synchronously without
   * dispatching the stream.
   */
  signal?: AbortSignal;
}

export interface Http2Response {
  status: number;
  headers: http2.IncomingHttpHeaders;
  body: string;
}

/**
 * Internal factory for creating HTTP/2 sessions. Visible for tests so an
 * in-process server can inject its own ClientSessionOptions (e.g. self-signed
 * CA bundle). Production callers do not pass this.
 */
export type Http2ConnectFactory = (
  origin: string,
  options?: http2.ClientSessionOptions | http2.SecureClientSessionOptions,
) => ClientHttp2Session;

const DEFAULT_CONNECT: Http2ConnectFactory = (origin, options) =>
  http2.connect(origin, options);

export interface Http2ClientOptions {
  origin: string;
  /** ms with no in-flight requests before the session is closed. Default 60_000. */
  idleTimeoutMs?: number;
  /**
   * Upper bound in ms that `close()` will wait for a graceful HTTP/2 close
   * before force-destroying the session. APNs healthy peers drain in
   * milliseconds; the default exists only so a stuck peer cannot hang
   * process teardown indefinitely. Set to 0 or negative to disable the
   * bound (graceful close with no timeout — the pre-5.x behavior). Default 5_000.
   */
  closeTimeoutMs?: number;
  /**
   * Fires exactly once when `close()` had to force-destroy the session
   * because the graceful close exceeded `closeTimeoutMs`. Receives the
   * elapsed wait time in ms. Hook errors are swallowed so an observability
   * hook can never block teardown. When omitted, the SDK emits a single
   * `console.warn` instead so the unusual condition is never silent.
   */
  onForcedDestroy?: (info: { elapsedMs: number }) => void;
  /** Test-only: override the connect factory. */
  connect?: Http2ConnectFactory;
  /** Test-only: extra options forwarded to http2.connect. */
  sessionOptions?: http2.ClientSessionOptions | http2.SecureClientSessionOptions;
}

/**
 * Manages a single HTTP/2 session lifecycle. Lazy connect on first request,
 * automatic reconnect when the session ends or receives GOAWAY, idle close
 * after `idleTimeoutMs`.
 */
export class Http2Client {
  readonly #origin: string;
  readonly #idleTimeoutMs: number;
  readonly #closeTimeoutMs: number;
  readonly #onForcedDestroy: ((info: { elapsedMs: number }) => void) | undefined;
  readonly #connect: Http2ConnectFactory;
  readonly #sessionOptions: http2.ClientSessionOptions | http2.SecureClientSessionOptions | undefined;
  #session: ClientHttp2Session | undefined;
  // In-flight dial promise. Concurrent #ensureSession() callers await the
  // same Promise so a cold-start burst (or N parallel retries after a
  // GOAWAY) produces ONE TLS handshake instead of N. Cleared in resolve and
  // reject paths so a failed dial doesn't poison subsequent attempts.
  #sessionPromise: Promise<ClientHttp2Session> | undefined;
  #inFlight = 0;
  #idleTimer: NodeJS.Timeout | undefined;
  #closed = false;
  // Memoized close() promise. close() is documented as idempotent — concurrent
  // or repeat callers receive the same promise and observe the same outcome
  // (graceful or forced) rather than each racing their own timeout against an
  // already-closing session.
  #closePromise: Promise<void> | undefined;
  // Each session gets a unique connect key so a request that hops to a
  // reconnect doesn't accidentally clean up the new session's idle timer.
  #sessionGeneration = 0;

  constructor(options: Http2ClientOptions) {
    this.#origin = options.origin;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    this.#closeTimeoutMs = options.closeTimeoutMs ?? 5_000;
    this.#onForcedDestroy = options.onForcedDestroy;
    this.#connect = options.connect ?? DEFAULT_CONNECT;
    this.#sessionOptions = options.sessionOptions;
  }

  get origin(): string {
    return this.#origin;
  }

  /**
   * Send a single HTTP/2 request. Establishes a session if none is open;
   * piggybacks on the existing one if so. The returned promise resolves with
   * the response (any status — non-2xx is the caller's problem) or rejects
   * with a transport-level error (ECONNRESET, etc.).
   */
  async request(init: Http2RequestInit): Promise<Http2Response> {
    if (this.#closed) {
      throw new Error("Http2Client is closed");
    }
    // Already-aborted signals short-circuit before any dial work. The
    // #executeRequest path also handles the aborted-before-stream-open case;
    // checking here saves the round-trip cost of ensureSession() too.
    if (init.signal?.aborted) {
      throw abortReason(init.signal);
    }
    // Race window: GOAWAY can fire between ensureSession resolving and
    // executeRequest dispatching, in which case dropSession() has already
    // cleared #session but the local reference still points at a closing
    // session. Re-dial once if the session is no longer healthy or was
    // replaced. Bounded to one retry so a flapping connection still surfaces
    // as a transport error to client.ts retry, rather than looping here.
    let session = await this.#ensureSession();
    if (this.#session !== session || session.closed || session.destroyed) {
      session = await this.#ensureSession();
    }
    this.#inFlight += 1;
    this.#cancelIdleTimer();
    try {
      return await this.#executeRequest(session, init);
    } finally {
      this.#inFlight -= 1;
      this.#scheduleIdleTimer();
    }
  }

  async #ensureSession(): Promise<ClientHttp2Session> {
    if (this.#session && !this.#session.closed && !this.#session.destroyed) {
      return this.#session;
    }
    if (this.#sessionPromise) {
      return this.#sessionPromise;
    }
    this.#sessionPromise = this.#dial().finally(() => {
      // Clear the slot regardless of outcome. Success: subsequent requests
      // pick up the cached #session and never re-enter this path. Failure:
      // the next caller gets a fresh dial attempt instead of inheriting the
      // poisoned promise.
      this.#sessionPromise = undefined;
    });
    return this.#sessionPromise;
  }

  #dial(): Promise<ClientHttp2Session> {
    return new Promise<ClientHttp2Session>((resolve, reject) => {
      const session = this.#connect(this.#origin, this.#sessionOptions);
      const generation = ++this.#sessionGeneration;
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onConnect = () => {
        cleanup();
        this.#session = session;
        // After connect, surface session-level lifecycle events so the next
        // request triggers a fresh dial.
        const dropSession = () => {
          if (this.#sessionGeneration === generation && this.#session === session) {
            this.#session = undefined;
          }
        };
        session.on("goaway", dropSession);
        session.on("close", dropSession);
        session.on("error", () => {
          // The error itself is surfaced on the per-request stream; here we
          // just make sure the session is dropped from the cache.
          dropSession();
        });
        resolve(session);
      };
      const cleanup = () => {
        session.removeListener("error", onError);
        session.removeListener("connect", onConnect);
      };
      session.once("error", onError);
      session.once("connect", onConnect);
    });
  }

  #executeRequest(
    session: ClientHttp2Session,
    init: Http2RequestInit,
  ): Promise<Http2Response> {
    return new Promise<Http2Response>((resolve, reject) => {
      // Already-aborted: never touch the wire.
      if (init.signal?.aborted) {
        reject(abortReason(init.signal));
        return;
      }
      let req: ClientHttp2Stream;
      try {
        req = session.request(init.headers as http2.OutgoingHttpHeaders);
      } catch (err) {
        reject(err);
        return;
      }
      const timeoutMs = init.timeoutMs ?? 30_000;
      if (timeoutMs > 0) {
        req.setTimeout(timeoutMs, () => {
          req.close(http2.constants.NGHTTP2_CANCEL);
          reject(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" }));
        });
      }
      req.setEncoding("utf8");
      let status = 0;
      let headers: http2.IncomingHttpHeaders = {};
      let body = "";
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        try {
          req.close(http2.constants.NGHTTP2_CANCEL);
        } catch {
          // stream may already be closing; ignore.
        }
        settled = true;
        reject(abortReason(init.signal));
      };
      if (init.signal) {
        init.signal.addEventListener("abort", onAbort, { once: true });
      }
      const cleanup = () => {
        settled = true;
        if (init.signal) {
          init.signal.removeEventListener("abort", onAbort);
        }
      };
      req.on("response", (h) => {
        status = Number(h[":status"] ?? 0);
        headers = h;
      });
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        if (settled) return;
        cleanup();
        resolve({ status, headers, body });
      });
      req.on("error", (err) => {
        if (settled) return;
        cleanup();
        reject(err);
      });
      if (init.body !== undefined) {
        req.write(init.body);
      }
      req.end();
    });
  }

  #cancelIdleTimer(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
    }
  }

  #scheduleIdleTimer(): void {
    if (this.#closed || this.#inFlight > 0) return;
    this.#cancelIdleTimer();
    if (this.#idleTimeoutMs <= 0) return;
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      const session = this.#session;
      if (session && this.#inFlight === 0) {
        this.#session = undefined;
        try {
          session.close();
        } catch {
          // session may already be closing; ignore.
        }
      }
    }, this.#idleTimeoutMs);
    this.#idleTimer.unref?.();
  }

  /**
   * Close the active session and refuse new requests. Waits up to
   * `closeTimeoutMs` (default 5_000 ms) for a graceful HTTP/2 close; if that
   * bound expires, force-destroys the session and notifies via
   * `onForcedDestroy` (or `console.warn` if no hook was supplied). Idempotent:
   * concurrent and repeat callers receive the same memoized promise and
   * observe the same outcome.
   *
   * A force-destroy here cancels any in-flight streams the peer never drained.
   * That is preferable to hanging process teardown indefinitely on a stuck
   * APNs peer; healthy peers always finish well before the bound.
   */
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#cancelIdleTimer();
    const session = this.#session;
    this.#session = undefined;
    if (!session || session.closed || session.destroyed) {
      this.#closePromise = Promise.resolve();
      return this.#closePromise;
    }
    const closeTimeoutMs = this.#closeTimeoutMs;
    const startedAt = Date.now();
    this.#closePromise = new Promise<void>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        resolve();
      };
      session.once("close", finish);
      if (closeTimeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return;
          // Graceful close did not finish in the allotted window; force the
          // session down so process teardown can proceed. session.destroy()
          // synchronously triggers the "close" event, which calls finish()
          // via the listener above; settled-guard prevents double-resolve.
          const elapsedMs = Date.now() - startedAt;
          try {
            session.destroy();
          } catch {
            // session may already be tearing itself down; ignore.
          }
          this.#notifyForcedDestroy(elapsedMs);
          // Belt-and-suspenders: if the "close" event somehow does not fire
          // after destroy() (e.g. listener was removed by a race), still
          // resolve so close() honors its contract.
          finish();
        }, closeTimeoutMs);
        timer.unref?.();
      }
      try {
        session.close();
      } catch {
        finish();
      }
    });
    return this.#closePromise;
  }

  #notifyForcedDestroy(elapsedMs: number): void {
    if (this.#onForcedDestroy) {
      try {
        this.#onForcedDestroy({ elapsedMs });
      } catch {
        // Observability hook errors must not propagate out of close().
      }
      return;
    }
    // Default channel for an unusual lifecycle event. The deprecation warning
    // in client.ts follows the same `console.warn` convention.
    console.warn(
      `[@mobile-surfaces/push] Http2Client.close() force-destroyed session after ${elapsedMs}ms; ` +
        "graceful HTTP/2 close exceeded closeTimeoutMs. Stuck peer or unresponsive APNs endpoint.",
    );
  }
}

/**
 * Resolve the rejection value for an aborted signal. Prefers `signal.reason`
 * when set (the user-supplied AbortController.abort(reason) value), otherwise
 * falls back to a generic Error tagged with name="AbortError" so consumers
 * pattern-matching on `err.name === "AbortError"` see a consistent shape.
 * Exported only via the Http2Client module's call sites; the package's
 * public AbortError class wraps this when surfacing aborts through PushClient.
 */
function abortReason(signal: AbortSignal | undefined): unknown {
  if (signal && signal.reason !== undefined) return signal.reason;
  const err = new Error("Request aborted");
  err.name = "AbortError";
  return err;
}
