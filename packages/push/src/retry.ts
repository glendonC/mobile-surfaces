// Retry policy and exponential-backoff helper. Used by PushClient when an
// HTTP/2 request fails with a retryable APNs reason or a connection-level
// transport error. Honors `Retry-After` from APNs when set on a 429.

import { DEFAULT_RETRYABLE_REASONS } from "./reasons.ts";

export interface RetryPolicy {
  /** Maximum retry attempts after the initial request. Default 3. */
  maxRetries: number;
  /** Base delay in ms for exponential backoff. Default 100. */
  baseDelayMs: number;
  /** Cap on a single backoff window. Default 5000. */
  maxDelayMs: number;
  /** Add jitter ∈ [0, baseDelayMs) to each computed backoff. Default true. */
  jitter: boolean;
  /** APNs reason strings considered retryable. */
  retryableReasons: ReadonlySet<string>;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  jitter: true,
  retryableReasons: DEFAULT_RETRYABLE_REASONS,
};

/**
 * Compute the next backoff window for `attempt` (0-indexed; first retry is
 * attempt 0). Returns `retryAfterMs` if provided (caller already converted
 * Retry-After seconds to ms). Otherwise: min(base * 2^attempt, max) + optional
 * jitter ∈ [0, base).
 */
export function computeBackoffMs(
  attempt: number,
  policy: RetryPolicy,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return retryAfterMs;
  }
  const exp = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  const jitter = policy.jitter ? Math.floor(random() * policy.baseDelayMs) : 0;
  return exp + jitter;
}

/**
 * Pause for `ms` milliseconds. Wrapped so tests can swap in a fake clock.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
      timer.unref();
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
        reject(signal.reason ?? new Error("Aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
