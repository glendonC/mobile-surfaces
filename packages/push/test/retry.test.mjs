// Backoff-distribution pin for the v5 audit fix to computeBackoffMs.
//
// Before v5 the math was `min(exp + jitter, maxDelayMs)`. Once exp + jitter
// crossed the cap, every saturated retry returned exactly `maxDelayMs` and
// jitter degenerated to a constant - which produces a thundering-herd risk
// whenever many clients hit the same APNs incident in lockstep.
//
// The v5 shape is `min(exp, maxDelayMs) + jitter`: the exponential is
// clamped first, then jitter is added. This keeps the returned values
// distributed across `[maxDelayMs, maxDelayMs + baseDelayMs)` at saturation
// instead of collapsing to a single point.
//
// computeBackoffMs is exported from the package surface in v5 (the v4 export
// list omitted it). The same function powers PushClient's retry loop, so a
// test for the audit fix's distribution shape directly observes what the
// retry path will do at saturation.

import test from "node:test";
import assert from "node:assert/strict";

const { computeBackoffMs } = await import("../dist/index.js");

test("jitter at saturation produces a non-degenerate distribution", () => {
  // baseDelayMs=100, maxDelayMs=500. At attempt=10 the exponential is
  // 100 * 2^10 = 102_400, well past the cap. Before v5, every call would
  // return exactly 500 (the cap). The v5 shape returns 500 + jitter, where
  // jitter is uniformly distributed in [0, 100).
  const policy = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 500,
    jitter: true,
    retryableReasons: new Set(),
  };
  const samples = [];
  for (let i = 0; i < 100; i += 1) {
    samples.push(computeBackoffMs(10, policy));
  }
  // Distribution must NOT collapse to the cap. A regression that reverts
  // the order (cap-then-add vs add-then-cap) would make `new Set(samples)`
  // contain exactly one value.
  const distinct = new Set(samples);
  assert.ok(
    distinct.size > 10,
    `saturated jitter should produce a varied distribution; got ${distinct.size} distinct values`,
  );
  // Every sample stays within [maxDelayMs, maxDelayMs + baseDelayMs).
  for (const s of samples) {
    assert.ok(
      s >= 500 && s < 600,
      `sample ${s} should sit in [500, 600); did the clamp move?`,
    );
  }
});

test("jitter at saturation is bounded by baseDelayMs above the cap", () => {
  // Same as above but with different magnitudes; pin the bound explicitly.
  const policy = {
    maxRetries: 3,
    baseDelayMs: 50,
    maxDelayMs: 1000,
    jitter: true,
    retryableReasons: new Set(),
  };
  for (let i = 0; i < 50; i += 1) {
    const ms = computeBackoffMs(20, policy);
    assert.ok(
      ms >= 1000 && ms < 1050,
      `expected sample in [1000, 1050), got ${ms}`,
    );
  }
});

test("jitter disabled returns exactly the clamped exponential at saturation", () => {
  const policy = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 500,
    jitter: false,
    retryableReasons: new Set(),
  };
  // With jitter off and exp >> max, the result is exactly maxDelayMs.
  for (let i = 0; i < 10; i += 1) {
    assert.equal(computeBackoffMs(10, policy), 500);
  }
});

test("unsaturated retries still return base * 2^attempt + jitter", () => {
  // Below the cap, the v5 shape and the v4 shape produce the same result -
  // because exp <= maxDelayMs makes the clamp a no-op. Pin this so we do
  // not accidentally break the small-attempt path while fixing saturation.
  const policy = {
    maxRetries: 5,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    jitter: true,
    retryableReasons: new Set(),
  };
  // attempt=0 -> exp=100, attempt=1 -> 200, attempt=2 -> 400; all well below
  // the 5000ms cap, so each sample sits in [exp, exp + baseDelayMs).
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const exp = 100 * 2 ** attempt;
    for (let i = 0; i < 20; i += 1) {
      const ms = computeBackoffMs(attempt, policy);
      assert.ok(
        ms >= exp && ms < exp + 100,
        `attempt=${attempt} sample ${ms} should sit in [${exp}, ${exp + 100})`,
      );
    }
  }
});

test("retryAfterMs short-circuits the backoff computation", () => {
  // Pinning the existing contract: when Retry-After is set, the policy's
  // exponential math is ignored entirely.
  const policy = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 500,
    jitter: true,
    retryableReasons: new Set(),
  };
  assert.equal(computeBackoffMs(0, policy, 2500), 2500);
  assert.equal(computeBackoffMs(10, policy, 0), 0);
});
