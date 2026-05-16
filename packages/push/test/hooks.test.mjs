// Coverage for the per-attempt observability contract documented on
// PushHooks in src/client.ts:
//
//   - onResponse fires after every 2xx response, once per attempt.
//   - onError  fires after every thrown error (transport or APNs non-2xx),
//                  once per attempt; isFinalAttempt distinguishes the in-flight
//                  retry leg from the leg the caller will actually see.
//   - Hook exceptions are swallowed and never break the send.
//   - Payload-validation failures (InvalidSnapshotError) throw before any
//     network attempt, so neither hook fires.
//
// The existing client.test.mjs covers the all-attempts-fail case for onError
// and the single-success case for onResponse. The gap closed here is the
// retry-then-succeed case for BOTH hooks (so isFinalAttempt is verified to
// flip from false to true across attempts), the typed-error class assertion
// on TooManyRequestsError, and the InvalidSnapshotError short-circuit.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const {
  createPushClient,
  TEST_TRANSPORT_OVERRIDE,
  TooManyRequestsError,
  InvalidSnapshotError,
} = await import("../dist/index.js");

import { generateEs256Pem, writeTempP8 } from "./fixtures/setup-cert.mjs";
import { startMockApns } from "./fixtures/mock-apns.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/active-snapshot.json"), "utf8"),
);
const WIDGET_SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/widget-snapshot.json"), "utf8"),
);

const PEM = generateEs256Pem();
const KEY = writeTempP8(PEM);

// Builds a client with the supplied hooks pointed at the in-process mock.
// `retryPolicy` lets a test tune the backoff/maxRetries; tests that exercise
// the priority-aware stretch (priority 10 alert sends) use update() so the
// configured maxRetries is not clamped.
function makeClient({ sendOrigin, hooks, retryPolicy } = {}) {
  return createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 1_000,
    _unsafeRetryOverride: retryPolicy,
    hooks,
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin },
  });
}

function teardown(t, client, mock) {
  t.after(async () => {
    await client.close();
    await mock.close();
  });
}

test("onResponse fires once per attempt: 500 then 200 yields two calls with the right isFinalAttempt flags", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls === 1) {
      // A bare 5xx with no parseable body — exercises the v5 audit fix that
      // retries any status>=500 regardless of parsed reason.
      return { status: 500, body: { reason: "InternalServerError" } };
    }
    return { status: 200, headers: { "apns-id": "after-retry" } };
  });
  const responseCalls = [];
  const errorCalls = [];
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    hooks: {
      onResponse: (ctx) => responseCalls.push(ctx),
      onError: (err, ctx) => errorCalls.push({ err, ctx }),
    },
  });
  teardown(t, client, mock);

  // update() is priority 5 so the priority-aware stretch does not clamp
  // maxRetries down from the configured value.
  const res = await client.update("u".repeat(64), SNAPSHOT, { apnsId: "after-retry" });
  assert.equal(res.status, 200);
  assert.equal(res.attempts, 2);

  // Per the documented contract: onResponse fires on every 2xx, onError fires
  // on every non-2xx. The 500 leg fires onError (isFinalAttempt=false because
  // the SDK will retry); the 200 leg fires onResponse (isFinalAttempt=true).
  assert.equal(errorCalls.length, 1, "onError fires once on the 500 attempt");
  assert.equal(errorCalls[0].ctx.attempt, 0);
  assert.equal(errorCalls[0].ctx.isFinalAttempt, false);
  assert.equal(errorCalls[0].ctx.status, 500);

  assert.equal(responseCalls.length, 1, "onResponse fires once on the 200 attempt");
  assert.equal(responseCalls[0].attempt, 1);
  assert.equal(responseCalls[0].isFinalAttempt, true);
  assert.equal(responseCalls[0].status, 200);
  assert.equal(responseCalls[0].operation, "update");
  assert.equal(responseCalls[0].snapshotId, SNAPSHOT.id);
});

test("onError fires once per attempt across two TooManyRequests retries before the eventual success", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls <= 2) {
      return {
        status: 429,
        headers: { "retry-after": "0" },
        body: { reason: "TooManyRequests" },
      };
    }
    return { status: 200, headers: { "apns-id": "ok-after-throttle" } };
  });
  const responseCalls = [];
  const errorCalls = [];
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    hooks: {
      onResponse: (ctx) => responseCalls.push(ctx),
      onError: (err, ctx) => errorCalls.push({ err, ctx }),
    },
  });
  teardown(t, client, mock);

  const res = await client.update(
    "t".repeat(64),
    SNAPSHOT,
    { apnsId: "ok-after-throttle" },
  );
  assert.equal(res.status, 200);
  assert.equal(res.attempts, 3);

  // Both failing attempts must show up; the contract is per-attempt so an
  // operator wiring Sentry sees the retry storm, not just the final outcome.
  assert.equal(errorCalls.length, 2, "onError fires on both throttled attempts");
  for (const [index, { err, ctx }] of errorCalls.entries()) {
    assert.ok(err instanceof TooManyRequestsError);
    assert.equal(err.reason, "TooManyRequests");
    assert.equal(err.trapId, "MS015");
    assert.equal(ctx.attempt, index);
    // Both attempts are followed by a retry, so both carry isFinalAttempt=false.
    assert.equal(ctx.isFinalAttempt, false);
    assert.equal(ctx.status, 429);
    assert.equal(ctx.operation, "update");
  }

  assert.equal(responseCalls.length, 1);
  assert.equal(responseCalls[0].attempt, 2);
  assert.equal(responseCalls[0].isFinalAttempt, true);
});

test("onError receives the typed TooManyRequestsError class with .reason and .trapId populated", async (t) => {
  // Pinpointed assertion that the hook's `error` argument is the typed
  // subclass — not a generic Error and not a plain object. The existing
  // client.test.mjs coverage for trapId uses TopicDisallowed (which is
  // terminal); this test covers the retryable-but-terminal-after-cap path
  // for TooManyRequests so the hook's error type is verified on the retry
  // leg as well as the give-up leg.
  const mock = await startMockApns(() => ({
    status: 429,
    headers: { "retry-after": "0" },
    body: { reason: "TooManyRequests" },
  }));
  const errorCalls = [];
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    hooks: {
      onError: (err, ctx) => errorCalls.push({ err, ctx }),
    },
  });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("r".repeat(64), SNAPSHOT),
    (err) => err instanceof TooManyRequestsError && err.reason === "TooManyRequests",
  );

  // 1 initial + 1 retry = 2 errors.
  assert.equal(errorCalls.length, 2);
  for (const { err } of errorCalls) {
    assert.ok(
      err instanceof TooManyRequestsError,
      "hook must receive the typed APNs subclass, not a generic Error",
    );
    assert.equal(err.reason, "TooManyRequests");
    assert.equal(err.trapId, "MS015");
  }
  // The retry leg is not the final leg; the give-up leg is.
  assert.equal(errorCalls[0].ctx.isFinalAttempt, false);
  assert.equal(errorCalls[1].ctx.isFinalAttempt, true);
});

test("onResponse that throws cannot break the send: result resolves with the expected PushResult", async (t) => {
  const mock = await startMockApns(() => ({
    status: 200,
    headers: { "apns-id": "fixed-after-hook-throw" },
  }));
  // Capture anything the hook isolator might forward to console.error — the
  // documented contract is silent swallow, so this should stay empty.
  const consoleErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => consoleErrors.push(args);
  t.after(() => {
    console.error = originalConsoleError;
  });

  const client = makeClient({
    sendOrigin: mock.origin,
    hooks: {
      onResponse: () => {
        throw new Error("hook intentionally throws");
      },
    },
  });
  teardown(t, client, mock);

  const res = await client.update(
    "h".repeat(64),
    SNAPSHOT,
    { apnsId: "fixed-after-hook-throw" },
  );
  // The send must complete normally even though the hook threw.
  assert.equal(res.status, 200);
  assert.equal(res.apnsId, "fixed-after-hook-throw");
  assert.equal(res.attempts, 1);

  // The PushHooks JSDoc declares the swallow is silent — the SDK does not
  // surface hook exceptions on console.error. Lock that behavior in so a
  // future "log the swallow" refactor cannot regress the contract without
  // updating both the docs and this test.
  assert.equal(
    consoleErrors.length,
    0,
    "hook exceptions are swallowed silently per the documented contract",
  );
});

test("hooks do not fire when validateSnapshot throws InvalidSnapshotError", async (t) => {
  // A wrong-kind snapshot fails validateSnapshot (or the kind guard) before
  // any HTTP attempt. The hooks contract is per-network-attempt — neither
  // should fire here, otherwise observability wiring would treat a payload
  // bug as a transport problem.
  const mock = await startMockApns(() => ({ status: 200 }));
  const responseCalls = [];
  const errorCalls = [];
  const client = makeClient({
    sendOrigin: mock.origin,
    hooks: {
      onResponse: (ctx) => responseCalls.push(ctx),
      onError: (err, ctx) => errorCalls.push({ err, ctx }),
    },
  });
  teardown(t, client, mock);

  // alert() requires kind=liveActivity; WIDGET_SNAPSHOT is kind=widget so the
  // kind guard rejects synchronously with InvalidSnapshotError.
  await assert.rejects(
    () => client.alert("w".repeat(64), WIDGET_SNAPSHOT),
    (err) => err instanceof InvalidSnapshotError,
  );

  assert.equal(responseCalls.length, 0, "onResponse must not fire on validation failure");
  assert.equal(errorCalls.length, 0, "onError must not fire on validation failure");
  assert.equal(
    mock.requests.length,
    0,
    "no network request should have been made for an invalid snapshot",
  );
});
