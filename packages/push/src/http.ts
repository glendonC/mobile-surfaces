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
  // Each session gets a unique connect key so a request that hops to a
  // reconnect doesn't accidentally clean up the new session's idle timer.
  #sessionGeneration = 0;

  constructor(options: Http2ClientOptions) {
    this.#origin = options.origin;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
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
      req.on("response", (h) => {
        status = Number(h[":status"] ?? 0);
        headers = h;
      });
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        resolve({ status, headers, body });
      });
      req.on("error", (err) => {
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
   * Close the active session and refuse new requests. Returns once the
   * session is fully torn down.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#cancelIdleTimer();
    const session = this.#session;
    this.#session = undefined;
    if (!session) return;
    if (session.closed || session.destroyed) return;
    await new Promise<void>((resolve) => {
      session.once("close", () => resolve());
      try {
        session.close();
      } catch {
        resolve();
      }
    });
  }
}
