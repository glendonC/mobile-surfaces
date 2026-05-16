// Token forwarder. Posts TokenRecord -> backend URL using the wire
// schema in ./wire.ts. The retry shape mirrors the push SDK
// (exponential backoff, jittered, with a `maxRetries` cap). The
// forwarder is a separate sub-path so a Node backend importing it for
// receiving-side validation does not have to drag React or the
// vanilla store in.
//
// Idempotency. The TokenRecord.idempotencyKey is recomputed on every
// emission for the same (kind, activityId, token) triple, so a server
// hashing the key as a dedupe column will see the same hash on every
// retry. Servers that already know about an idempotencyKey should
// respond 409 Conflict; the forwarder treats 409 as success
// ({ kind: "skipped", reason: "duplicate-idempotency-key" }).
//
// 4xx (other) is non-retryable. 5xx and network errors are retried
// with backoff up to `maxRetries`.

import { MobileSurfacesError } from "@mobile-surfaces/traps";
import type { TokenRecord } from "./index.ts";
import {
  tokenForwarderRequestSchema,
  type TokenForwarderRequest,
} from "./wire.ts";

export interface ForwarderConfig {
  url: string;
  /** Inject a fetch impl. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Extra headers (Authorization, etc.). Merged into the POST request. */
  headers?: Record<string, string>;
  /** Cap on retries beyond the initial attempt. Default 3. */
  maxRetries?: number;
  /** Per-attempt timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Caller-supplied abort signal. Cancels the whole forward (all retries). */
  signal?: AbortSignal;
  /** Base ms for the exponential backoff. Default 100. */
  baseDelayMs?: number;
  /** Cap on a single backoff window. Default 5000. */
  maxDelayMs?: number;
  /** Jitter switch. Default true. */
  jitter?: boolean;
  /** Stamp this version into every outgoing request. Default "1". */
  schemaVersion?: "1";
}

export type ForwardResult =
  | { kind: "ok"; status: number; attempts: number }
  | { kind: "skipped"; reason: "duplicate-idempotency-key" }
  | {
      kind: "error";
      message: string;
      attempts: number;
      retryable: boolean;
      status?: number;
    };

export interface TokenForwarder {
  forward(record: TokenRecord): Promise<ForwardResult>;
}

/**
 * Failures from the forwarder are not catalog traps (network
 * conditions, not silent-failure modes), but they still extend
 * MobileSurfacesError so callers can log `err.trapId` uniformly
 * without a per-package check. trapId resolves to undefined.
 */
export class TokenForwarderError extends MobileSurfacesError {
  readonly status?: number;
  readonly attempts: number;
  readonly retryable: boolean;
  constructor(message: string, opts: {
    status?: number;
    attempts: number;
    retryable: boolean;
  }) {
    super(message);
    this.name = "TokenForwarderError";
    this.status = opts.status;
    this.attempts = opts.attempts;
    this.retryable = opts.retryable;
  }
}

function toWire(record: TokenRecord): TokenForwarderRequest {
  return {
    kind: record.kind,
    token: record.token,
    ...(record.activityId !== undefined
      ? { activityId: record.activityId }
      : {}),
    environment: record.environment,
    recordedAt: record.recordedAt,
    lifecycle: record.lifecycle,
    idempotencyKey: record.idempotencyKey,
    schemaVersion: "1",
  };
}

// Same shape as packages/push/src/retry.ts computeBackoffMs: exponent
// is clamped first, then jitter is added so the distribution is
// non-degenerate at saturation.
function computeBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean,
): number {
  const exp = baseDelayMs * 2 ** attempt;
  const capped = Math.min(exp, maxDelayMs);
  const jitterAmount = jitter ? Math.floor(Math.random() * baseDelayMs) : 0;
  return capped + jitterAmount;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (
      typeof (timer as { unref?: () => void }).unref === "function"
    ) {
      (timer as { unref: () => void }).unref();
    }
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error("Aborted"));
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal) {
      if (signal.aborted) {
        cleanup();
        return reject(signal.reason ?? new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

export function createTokenForwarder(cfg: ForwarderConfig): TokenForwarder {
  const fetchImpl = cfg.fetch ?? (globalThis.fetch?.bind(globalThis));
  if (!fetchImpl) {
    throw new TokenForwarderError(
      "createTokenForwarder: no fetch implementation available. Pass `fetch` explicitly or run in a runtime that provides globalThis.fetch.",
      { attempts: 0, retryable: false },
    );
  }
  const maxRetries = cfg.maxRetries ?? 3;
  const timeoutMs = cfg.timeoutMs ?? 5000;
  const baseDelayMs = cfg.baseDelayMs ?? 100;
  const maxDelayMs = cfg.maxDelayMs ?? 5000;
  const jitter = cfg.jitter ?? true;

  async function attempt(
    body: string,
  ): Promise<{ status: number; ok: boolean }> {
    const ac = new AbortController();
    const onAbort = () => ac.abort(cfg.signal?.reason ?? new Error("Aborted"));
    if (cfg.signal) {
      if (cfg.signal.aborted) {
        ac.abort(cfg.signal.reason ?? new Error("Aborted"));
      } else {
        cfg.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    try {
      const res = await fetchImpl(cfg.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.headers ?? {}),
        },
        body,
        signal: ac.signal,
      });
      return { status: res.status, ok: res.ok };
    } finally {
      clearTimeout(timer);
      cfg.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function forward(record: TokenRecord): Promise<ForwardResult> {
    const wire = toWire(record);
    const parsed = tokenForwarderRequestSchema.safeParse(wire);
    if (!parsed.success) {
      return {
        kind: "error",
        message: `token record fails wire validation: ${parsed.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
        attempts: 0,
        retryable: false,
      };
    }
    const body = JSON.stringify(parsed.data);

    let lastError: { message: string; status?: number } | undefined;
    const total = Math.max(0, maxRetries) + 1;
    for (let i = 0; i < total; i++) {
      try {
        const res = await attempt(body);
        if (res.status === 409) {
          return { kind: "skipped", reason: "duplicate-idempotency-key" };
        }
        if (res.ok) {
          return { kind: "ok", status: res.status, attempts: i + 1 };
        }
        if (!isRetryableStatus(res.status)) {
          return {
            kind: "error",
            message: `forwarder rejected: HTTP ${res.status}`,
            attempts: i + 1,
            retryable: false,
            status: res.status,
          };
        }
        lastError = {
          message: `forwarder retryable status: HTTP ${res.status}`,
          status: res.status,
        };
      } catch (err) {
        // Network / timeout. Retryable unless the caller's signal
        // aborted (in which case bail without spending the budget).
        if (cfg.signal?.aborted) {
          return {
            kind: "error",
            message: "forwarder aborted by caller signal",
            attempts: i + 1,
            retryable: false,
          };
        }
        lastError = { message: messageOf(err) };
      }
      if (i < total - 1) {
        const delay = computeBackoffMs(i, baseDelayMs, maxDelayMs, jitter);
        try {
          await sleep(delay, cfg.signal);
        } catch {
          return {
            kind: "error",
            message: "forwarder aborted by caller signal",
            attempts: i + 1,
            retryable: false,
          };
        }
      }
    }
    return {
      kind: "error",
      message: lastError?.message ?? "forwarder exhausted retries",
      attempts: total,
      retryable: true,
      ...(lastError?.status !== undefined ? { status: lastError.status } : {}),
    };
  }

  return { forward };
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
