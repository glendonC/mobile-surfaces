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
 * Stretch a base retry policy for an APNs priority-10 send. Per MS015,
 * priority 10 is for user-visible state transitions and is heavily budgeted
 * by iOS — sustained retries amplify the throttling that already triggered
 * the original failure. The priority-10 stretch:
 *
 * - clamps `maxRetries` to at most 2 (so failures surface to the caller
 *   sooner instead of burning through the iOS budget)
 * - doubles `baseDelayMs` and `maxDelayMs` (so retries are spaced further
 *   apart, giving the throttle window time to clear)
 *
 * Priority 5 (Live Activity content-state updates) keeps the base policy
 * unchanged. The function never widens limits — `maxRetries` is the floor
 * of the user-configured value, never above 2.
 */
export function effectiveRetryPolicy(
  base: RetryPolicy,
  priority: 5 | 10,
): RetryPolicy {
  if (priority !== 10) return base;
  return {
    ...base,
    maxRetries: Math.min(base.maxRetries, 2),
    baseDelayMs: base.baseDelayMs * 2,
    maxDelayMs: base.maxDelayMs * 2,
  };
}

/**
 * Compute the next backoff window for `attempt` (0-indexed; first retry is
 * attempt 0). Returns `retryAfterMs` if provided (caller already converted
 * Retry-After seconds to ms). Otherwise: min(base * 2^attempt, maxDelayMs)
 * + jitter, where jitter ∈ [0, baseDelayMs) when enabled.
 *
 * Audit fix (v5): jitter is applied AFTER the exponential is clamped to
 * `maxDelayMs`, not before. The previous shape — `min(exp + jitter, max)` —
 * would saturate every retry at exactly `maxDelayMs` once `exp + jitter`
 * exceeded the cap, collapsing the distribution to a constant and creating
 * a thundering-herd risk when many clients retry the same incident in
 * lockstep. Clamping first preserves jitter at saturation. The new ceiling
 * is `maxDelayMs + baseDelayMs - 1` rather than strictly `maxDelayMs`; this
 * is the deliberate trade — a small (<= baseDelayMs) overshoot that keeps
 * the distribution non-degenerate vs. a hard cap that produces synchronized
 * retries.
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
  const exp = policy.baseDelayMs * 2 ** attempt;
  const capped = Math.min(exp, policy.maxDelayMs);
  const jitter = policy.jitter ? Math.floor(random() * policy.baseDelayMs) : 0;
  return capped + jitter;
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
