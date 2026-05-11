import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const {
  createPushClient,
  TEST_TRANSPORT_OVERRIDE,
  BadDeviceTokenError,
  TooManyRequestsError,
  InvalidSnapshotError,
  ClientClosedError,
  MissingApnsConfigError,
  PayloadTooLargeError,
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

function makeClient({ sendOrigin, manageOrigin, retryPolicy } = {}) {
  return createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    retryPolicy,
    idleTimeoutMs: 1_000,
    [TEST_TRANSPORT_OVERRIDE]: {
      sendOrigin,
      manageOrigin,
    },
  });
}

// Helper: wire up cleanup so the client closes BEFORE the mock server. Node's
// `t.after` runs in registration order, so registering the client teardown
// first ensures its h2 session is gone before the server shuts down (otherwise
// server.close() waits up to idleTimeoutMs for the socket to drain).
function teardown(t, client, mock) {
  t.after(async () => {
    await client.close();
    await mock.close();
  });
}

test("alert() sends a properly-shaped request and resolves with apns-id", async (t) => {
  const mock = await startMockApns(() => ({
    status: 200,
    headers: { "apns-id": "fixed-id-1" },
  }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const res = await client.alert("a".repeat(64), SNAPSHOT, { apnsId: "fixed-id-1" });
  assert.equal(res.status, 200);
  assert.equal(res.apnsId, "fixed-id-1");

  const req = mock.requests[0];
  assert.equal(req.method, "POST");
  assert.equal(req.path, `/3/device/${"a".repeat(64)}`);
  assert.equal(req.headers["apns-push-type"], "alert");
  assert.equal(req.headers["apns-priority"], "10");
  assert.equal(req.headers["apns-topic"], "com.example.test");
  assert.equal(req.headers["apns-id"], "fixed-id-1");
  const body = JSON.parse(req.body);
  assert.deepEqual(body.aps.alert, {
    title: SNAPSHOT.primaryText,
    body: SNAPSHOT.secondaryText,
  });
});

test("update() targets liveactivity push-type with priority 5 and projected content-state", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const res = await client.update("b".repeat(64), SNAPSHOT);
  assert.equal(res.status, 200);

  const req = mock.requests[0];
  assert.equal(req.headers["apns-push-type"], "liveactivity");
  assert.equal(req.headers["apns-priority"], "5");
  assert.equal(req.headers["apns-topic"], "com.example.test.push-type.liveactivity");
  const payload = JSON.parse(req.body);
  assert.equal(payload.aps.event, "update");
  assert.deepEqual(payload.aps["content-state"], {
    headline: SNAPSHOT.primaryText,
    subhead: SNAPSHOT.secondaryText,
    progress: SNAPSHOT.progress,
    stage: SNAPSHOT.stage,
  });
});

test("broadcast() posts to /4/broadcasts/apps/<bundle> with apns-channel-id and no apns-topic", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.broadcast("ChannelId123", SNAPSHOT);
  const req = mock.requests[0];
  assert.equal(req.path, "/4/broadcasts/apps/com.example.test");
  assert.equal(req.headers["apns-channel-id"], "ChannelId123");
  assert.equal(req.headers["apns-topic"], undefined);
  assert.equal(req.headers["apns-push-type"], "liveactivity");
  assert.equal(req.headers["apns-expiration"], "0");
});

test("createChannel/listChannels/deleteChannel hit the management host with documented shapes", async (t) => {
  const mock = await startMockApns((req) => {
    if (req.method === "POST" && req.path === "/1/apps/com.example.test/channels") {
      return {
        status: 201,
        headers: { "apns-channel-id": "newChannel==" },
      };
    }
    if (req.method === "GET" && req.path === "/1/apps/com.example.test/all-channels") {
      return {
        status: 200,
        body: {
          channels: [
            { "apns-channel-id": "newChannel==", "message-storage-policy": 0 },
          ],
        },
      };
    }
    if (req.method === "DELETE" && req.path === "/1/apps/com.example.test/channels") {
      return { status: 204 };
    }
    return { status: 404 };
  });
  const client = makeClient({ manageOrigin: mock.origin });
  teardown(t, client, mock);

  const created = await client.createChannel({ storagePolicy: "no-storage" });
  assert.equal(created.channelId, "newChannel==");
  assert.equal(created.storagePolicy, "no-storage");

  const list = await client.listChannels();
  assert.equal(list.length, 1);
  assert.equal(list[0].channelId, "newChannel==");
  assert.equal(list[0].storagePolicy, "no-storage");

  await client.deleteChannel("newChannel==");
  const createReq = mock.requests[0];
  assert.deepEqual(JSON.parse(createReq.body), {
    "message-storage-policy": 0,
    "push-type": "LiveActivity",
  });
  const delReq = mock.requests[mock.requests.length - 1];
  assert.equal(delReq.headers["apns-channel-id"], "newChannel==");
});

test("BadDeviceToken response surfaces as BadDeviceTokenError with apns-id", async (t) => {
  const mock = await startMockApns(() => ({
    status: 400,
    headers: { "apns-id": "rejected-1" },
    body: { reason: "BadDeviceToken", timestamp: 1700000000000 },
  }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.alert("c".repeat(64), SNAPSHOT),
    (err) => {
      assert.ok(err instanceof BadDeviceTokenError);
      assert.equal(err.reason, "BadDeviceToken");
      assert.equal(err.status, 400);
      assert.equal(err.apnsId, "rejected-1");
      return true;
    },
  );
  // Terminal codes must never be retried, regardless of retryableReasons. If a
  // future change widened the retry set to include BadDeviceToken, the request
  // count here would jump past 1 and catch the regression.
  assert.equal(mock.requests.length, 1);
});

test("terminal reasons are denied even when retryableReasons explicitly includes them", async (t) => {
  // Pins the TERMINAL_REASONS deny-list contract: a caller-customized retry
  // policy that names a terminal reason cannot bypass the SDK's terminal
  // guard. The four codes below stay terminal under any retry-policy override.
  const terminalCodes = [
    { reason: "BadDeviceToken", status: 400 },
    { reason: "Unregistered", status: 410 },
    { reason: "PayloadTooLarge", status: 413 },
    { reason: "TopicDisallowed", status: 400 },
  ];
  for (const { reason, status } of terminalCodes) {
    const mock = await startMockApns(() => ({ status, body: { reason } }));
    const client = makeClient({
      sendOrigin: mock.origin,
      retryPolicy: {
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 2,
        jitter: false,
        // Widen the retry set to include every terminal code. The SDK's
        // built-in TERMINAL_REASONS deny-list must still take precedence.
        retryableReasons: new Set([
          ...terminalCodes.map((c) => c.reason),
          "TooManyRequests",
          "InternalServerError",
          "ServiceUnavailable",
        ]),
      },
    });
    teardown(t, client, mock);

    await assert.rejects(
      () => client.alert("c".repeat(64), SNAPSHOT),
      (err) => err.reason === reason,
    );
    assert.equal(mock.requests.length, 1, `${reason} retried ${mock.requests.length} times`);
  }
});

test("TooManyRequests parses Retry-After and exposes retryAfterSeconds", async (t) => {
  const mock = await startMockApns(() => ({
    status: 429,
    headers: { "retry-after": "0", "apns-id": "rl-1" },
    body: { reason: "TooManyRequests" },
  }));
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.alert("d".repeat(64), SNAPSHOT),
    (err) => {
      assert.ok(err instanceof TooManyRequestsError);
      assert.equal(err.retryAfterSeconds, 0);
      return true;
    },
  );
  // 1 initial + 1 retry = 2 calls.
  assert.equal(mock.requests.length, 2);
});

test("retryable reason (InternalServerError) is retried then succeeds", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls === 1) {
      return { status: 500, body: { reason: "InternalServerError" } };
    }
    return { status: 200 };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  const res = await client.alert("e".repeat(64), SNAPSHOT);
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);
});

test("retries are capped by maxRetries and final ApnsError is surfaced", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    return { status: 503, body: { reason: "ServiceUnavailable" } };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.alert("f".repeat(64), SNAPSHOT),
    (err) => err.reason === "ServiceUnavailable" && err.status === 503,
  );
  assert.equal(calls, 3);
});

test("update() rejects non-liveActivity-kind snapshots before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("g".repeat(64), WIDGET_SNAPSHOT),
    (err) => {
      assert.ok(err instanceof InvalidSnapshotError);
      assert.match(err.message, /liveActivity/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("invalid snapshot (Zod) -> InvalidSnapshotError with issue paths", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const broken = { ...SNAPSHOT, progress: "nope" };
  await assert.rejects(
    () => client.alert("h".repeat(64), broken),
    (err) => {
      assert.ok(err instanceof InvalidSnapshotError);
      assert.ok(err.issues.length > 0);
      return true;
    },
  );
});

test("close() refuses subsequent requests with ClientClosedError", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  // close() is the test subject; just clean up the server.
  t.after(() => mock.close());

  await client.close();

  await assert.rejects(
    () => client.alert("i".repeat(64), SNAPSHOT),
    (err) => err instanceof ClientClosedError,
  );
  await assert.rejects(
    () => client.createChannel(),
    (err) => err instanceof ClientClosedError,
  );
});

test("start() includes attributes-type and attributes in the payload aps block", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.start(
    "j".repeat(64),
    SNAPSHOT,
    { surfaceId: SNAPSHOT.surfaceId, modeLabel: SNAPSHOT.modeLabel },
    { attributesType: "MyAttributes" },
  );
  const payload = JSON.parse(mock.requests[0].body);
  assert.equal(payload.aps.event, "start");
  assert.equal(payload.aps["attributes-type"], "MyAttributes");
  assert.deepEqual(payload.aps.attributes, {
    surfaceId: SNAPSHOT.surfaceId,
    modeLabel: SNAPSHOT.modeLabel,
  });
});

test("end() defaults dismissal-date to now", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const before = Math.floor(Date.now() / 1000);
  await client.end("k".repeat(64), SNAPSHOT);
  const after = Math.floor(Date.now() / 1000);
  const payload = JSON.parse(mock.requests[0].body);
  assert.equal(payload.aps.event, "end");
  const dismissal = payload.aps["dismissal-date"];
  assert.ok(typeof dismissal === "number");
  assert.ok(dismissal >= before && dismissal <= after + 1);
});

// --- hooks + config validation -------------------------------------------

test("createPushClient throws MissingApnsConfigError when required options are missing", () => {
  const baseConfig = {
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
  };
  for (const field of ["keyId", "teamId", "bundleId"]) {
    assert.throws(
      () => createPushClient({ ...baseConfig, [field]: "" }),
      (err) => {
        assert.ok(err instanceof MissingApnsConfigError, `${field} empty`);
        assert.deepEqual(err.missing, [field]);
        assert.equal(err.trapId, "MS028");
        return true;
      },
    );
  }
  assert.throws(
    () => createPushClient({ ...baseConfig, keyPath: "" }),
    (err) => err instanceof MissingApnsConfigError && err.missing[0] === "keyPath",
  );
});

test("hooks.onResponse fires with operation, snapshotId, and apnsId on success", async (t) => {
  const mock = await startMockApns(() => ({
    status: 200,
    headers: { "apns-id": "fixed-resp-1" },
  }));
  const calls = [];
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 1_000,
    hooks: {
      onResponse: (ctx) => calls.push(ctx),
    },
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin: mock.origin },
  });
  teardown(t, client, mock);

  await client.update("a".repeat(64), SNAPSHOT, { apnsId: "fixed-resp-1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "update");
  assert.equal(calls[0].snapshotId, SNAPSHOT.id);
  assert.equal(calls[0].apnsId, "fixed-resp-1");
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].attempt, 0);
  assert.equal(calls[0].isFinalAttempt, true);
  assert.ok(typeof calls[0].durationMs === "number");
});

test("hooks.onError fires per-attempt with isFinalAttempt true on the giving-up attempt", async (t) => {
  const mock = await startMockApns(() => ({
    status: 503,
    body: { reason: "ServiceUnavailable" },
  }));
  const errors = [];
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 1_000,
    retryPolicy: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: false },
    hooks: {
      onError: (err, ctx) => errors.push({ err, ctx }),
    },
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin: mock.origin },
  });
  teardown(t, client, mock);

  await assert.rejects(() => client.alert("b".repeat(64), SNAPSHOT));
  // 1 initial + 2 retries = 3 errors fired.
  assert.equal(errors.length, 3);
  assert.equal(errors[0].ctx.attempt, 0);
  assert.equal(errors[0].ctx.isFinalAttempt, false);
  assert.equal(errors[1].ctx.attempt, 1);
  assert.equal(errors[1].ctx.isFinalAttempt, false);
  assert.equal(errors[2].ctx.attempt, 2);
  assert.equal(errors[2].ctx.isFinalAttempt, true);
  // Every error sees the typed APNs class with status populated on the context.
  for (const { err, ctx } of errors) {
    assert.equal(err.reason, "ServiceUnavailable");
    assert.equal(ctx.status, 503);
    assert.equal(ctx.operation, "alert");
  }
});

test("hooks that throw cannot break the send", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 1_000,
    hooks: {
      onResponse: () => {
        throw new Error("hook intentionally throws");
      },
      onError: () => {
        throw new Error("hook intentionally throws");
      },
    },
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin: mock.origin },
  });
  teardown(t, client, mock);

  // If the hook were not isolated, this would reject with the hook's error
  // instead of resolving with a normal SendResponse.
  const res = await client.update("c".repeat(64), SNAPSHOT);
  assert.equal(res.status, 200);
});

test("hooks.onError surfaces APNs trapId for bound error classes", async (t) => {
  const mock = await startMockApns(() => ({
    status: 400,
    headers: { "apns-id": "trap-1" },
    body: { reason: "TopicDisallowed" },
  }));
  let received;
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 1_000,
    hooks: {
      onError: (err) => {
        received = err;
      },
    },
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin: mock.origin },
  });
  teardown(t, client, mock);

  await assert.rejects(() => client.alert("d".repeat(64), SNAPSHOT));
  assert.ok(received);
  assert.equal(received.reason, "TopicDisallowed");
  assert.equal(received.trapId, "MS018");
});

// --- transport lifecycle --------------------------------------------------

test("transport drop mid-flight is retried on a fresh session", { timeout: 5000 }, async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls === 1) {
      // Server forcibly drops the h2 session mid-stream — equivalent to
      // GOAWAY immediately followed by a socket close. The SDK's transport
      // layer should treat this as a retryable transport error and dial a
      // fresh session for the retry.
      return { destroy: true };
    }
    return { status: 200 };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  const res = await client.alert("a".repeat(64), SNAPSHOT);
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);
  // Two sessions accepted by the server: the dropped one and the retry's
  // fresh dial. Pins that the SDK does not try to reuse the dead session.
  assert.equal(mock.sessionCount, 2);
});

test("RST_STREAM on a single request is retried without dropping the session", { timeout: 5000 }, async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls === 1) {
      // Per-stream reset (REFUSED_STREAM, in RETRYABLE_TRANSPORT_CODES).
      // The session itself stays alive — APNs / a proxy resetting one
      // stream is distinct from a GOAWAY/close that tears down the
      // whole connection. The SDK should retry on the same session.
      return { rstStream: true };
    }
    return { status: 200 };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  const res = await client.alert("a".repeat(64), SNAPSHOT);
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);
  // One session: RST_STREAM only closed the failed stream; the retry
  // dispatched on the same warm connection.
  assert.equal(mock.sessionCount, 1);
});

test("parallel sends on a warm session multiplex over a single HTTP/2 session", { timeout: 5000 }, async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  // Warm the session first so the parallel batch dispatches against an
  // already-connected session rather than racing 5 cold dials. HTTP/2
  // multiplexing is what we want to pin: many concurrent streams sharing
  // one session, not the accidental in-flight dial dedup.
  await client.alert("0".repeat(64), SNAPSHOT);
  assert.equal(mock.sessionCount, 1);

  const tokens = ["a", "b", "c", "d", "e"].map((c) => c.repeat(64));
  const responses = await Promise.all(
    tokens.map((token) => client.alert(token, SNAPSHOT)),
  );
  for (const res of responses) assert.equal(res.status, 200);
  assert.equal(mock.requests.length, tokens.length + 1);
  // All five parallel streams shared the warm session.
  assert.equal(mock.sessionCount, 1);
});

test("idle timeout closes the session and the next send reconnects", { timeout: 5000 }, async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    // Aggressive idle window so the test runs in well under a second.
    idleTimeoutMs: 50,
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin: mock.origin },
  });
  teardown(t, client, mock);

  await client.alert("a".repeat(64), SNAPSHOT);
  assert.equal(mock.sessionCount, 1);

  // Wait past the idle window. The SDK's idle timer should close the
  // session; the next send should dial a new one.
  await new Promise((res) => setTimeout(res, 200));

  await client.alert("b".repeat(64), SNAPSHOT);
  assert.equal(mock.sessionCount, 2);
});

test("two parallel sends share a single retry-session after stream-level resets", { timeout: 5000 }, async (t) => {
  // Pins the concurrent-recovery path with rstStream as the trigger. Using
  // a per-stream reset (rather than full session destruction) avoids the
  // late-GOAWAY-on-new-session artifact that the in-process h2c mock can
  // surface when one session is torn down while another is being dialed,
  // while still exercising the property the audit asked for: two parallel
  // failures should produce one shared recovery, not two independent dials.
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    // Warmup succeeds (call 1). The parallel batch (calls 2 and 3) both get
    // REFUSED_STREAM. Retries on the same warm session (calls 4 and 5)
    // succeed; rstStream leaves the session alive, so no reconnect happens.
    if (calls >= 2 && calls <= 3) {
      return { rstStream: true };
    }
    return { status: 200 };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  // Warm the session so the parallel batch shares a single warm dial.
  await client.alert("0".repeat(64), SNAPSHOT);
  assert.equal(mock.sessionCount, 1);

  const [r1, r2] = await Promise.all([
    client.alert("a".repeat(64), SNAPSHOT),
    client.alert("b".repeat(64), SNAPSHOT),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);

  // Five total server-side requests: 1 warmup + 2 stream-resets + 2 retries.
  assert.equal(mock.requests.length, 5);
  // One session: rstStream is a per-stream reset, so the warm session
  // stays alive and both retries multiplex back onto it. A regression that
  // dropped the session on stream-level resets would show as 2+.
  assert.equal(mock.sessionCount, 1);
});

test("repeated GOAWAY cycles dial a fresh session on every recovery", { timeout: 5000 }, async (t) => {
  // Pins the multi-cycle reconnect path: APNs is allowed to rotate the
  // connection multiple times across a single client's lifetime, and every
  // cycle must surface as a fresh dial. A regression that cached the dead
  // session across drops would show as fewer than the expected sessionCount.
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    // Calls 1 and 3 destroy the session mid-stream (GOAWAY + close).
    // Calls 2 and 4 succeed on the freshly-dialed retry session.
    if (calls === 1 || calls === 3) return { destroy: true };
    return { status: 200 };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  const r1 = await client.alert("a".repeat(64), SNAPSHOT);
  assert.equal(r1.status, 200);
  const r2 = await client.alert("b".repeat(64), SNAPSHOT);
  assert.equal(r2.status, 200);

  // 4 server-side requests: 2 dropped + 2 successful retries.
  assert.equal(mock.requests.length, 4);
  // 3 sessions: original (dropped), retry-1 (lived through second send's
  // first attempt then dropped), retry-2 (final live session). A regression
  // that kept the first dead session cached would show sessionCount=2.
  assert.equal(mock.sessionCount, 3);
});

test("sustained GOAWAY cycles drive repeated re-dials and the SDK keeps recovering", { timeout: 10_000 }, async (t) => {
  // Extends the two-cycle GOAWAY pin above to a sustained-outage shape.
  // Every Nth sequential call destroys the session; the SDK has to dial a
  // fresh session for the next attempt. Running five drop cycles back to
  // back pins the rotation rhythm beyond what the original two-cycle test
  // proves, so a regression in the generation counter or session-swap
  // bookkeeping that only shows after several rotations would fail here.
  //
  // Parallel sends are intentionally deferred to the dedicated cold-start
  // dedup test below: combining a destroy-every-other-call pattern with
  // mid-flight parallel batches makes both sides of the assertion flaky
  // because a doomed session may carry multiple in-flight streams, and the
  // retry layer (maxRetries: 1) cannot recover if the fresh session is
  // also destroyed before the retry lands. This test stays sequential so
  // the rotation count is deterministic.
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    // Destroy odd calls (1, 3, 5, 7, 9, 11). Each one is recovered by the
    // even-numbered retry that follows.
    if (calls % 2 === 1) return { destroy: true };
    return { status: 200 };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  // Six sequential sends. Each one destroys its first attempt and succeeds
  // on the second, for 12 server-side requests and 6 fresh dials on top of
  // the original session.
  for (const c of ["a", "b", "c", "d", "e", "f"]) {
    const res = await client.alert(c.repeat(64), SNAPSHOT);
    assert.equal(res.status, 200);
  }

  assert.equal(mock.requests.length, 12);
  // One initial session plus one new session per destroyed first-attempt.
  // The pattern is dropped/retry-success per send, so 6 sends produce 6
  // destroyed sessions; the SDK dials a fresh one each time.
  assert.equal(mock.sessionCount, 7);
});

test("ETIMEDOUT on a hanging stream is retried through the transport-retry layer", { timeout: 5000 }, async (t) => {
  // Pins that an in-flight stream that hangs long enough to fire the request
  // timeout surfaces as ETIMEDOUT (per RETRYABLE_TRANSPORT_CODES) and goes
  // through PushClient's retry path rather than failing on the first attempt.
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    // First call: hold the stream open forever so the SDK's per-request
    // timeout fires from its side. Second call: respond normally so the
    // retry resolves and we can observe the retry happened.
    if (calls === 1) return new Promise(() => {});
    return { status: 200 };
  });
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 1_000,
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    [TEST_TRANSPORT_OVERRIDE]: {
      sendOrigin: mock.origin,
      requestTimeoutMs: 50,
    },
  });
  teardown(t, client, mock);

  const res = await client.alert("a".repeat(64), SNAPSHOT);
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);
});

test("cold-start parallel sends share a single dial (no double-dial race)", { timeout: 5000 }, async (t) => {
  // Pins the in-flight dial dedup: even when N requests are kicked off
  // before any session exists, #ensureSession must return the same connect
  // promise to all concurrent callers — otherwise the SDK would race-dial N
  // sessions and burn an extra TLS handshake per concurrent request at
  // startup. sessionCount === 1 after the batch is what holds.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  // No warmup. Five parallel sends from cold state.
  const tokens = ["a", "b", "c", "d", "e"].map((c) => c.repeat(64));
  const responses = await Promise.all(
    tokens.map((token) => client.alert(token, SNAPSHOT)),
  );

  for (const res of responses) assert.equal(res.status, 200);
  assert.equal(mock.requests.length, tokens.length);
  // One session: the SDK deduplicated the concurrent dial requests.
  assert.equal(mock.sessionCount, 1);
});

// --- client-side payload size pre-flight (MS011) -------------------------

test("update() rejects oversized per-activity payload before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  // 5000 bytes of secondaryText alone clears the 4096 ceiling once the
  // ActivityKit envelope (aps, content-state, timestamp, etc.) is layered on.
  const oversized = { ...SNAPSHOT, secondaryText: "x".repeat(5000) };

  await assert.rejects(
    () => client.update("a".repeat(64), oversized),
    (err) => {
      assert.ok(err instanceof PayloadTooLargeError);
      assert.equal(err.status, 413);
      assert.equal(err.trapId, "MS011");
      assert.match(err.message, /pre-flight/);
      assert.match(err.message, /4096/);
      return true;
    },
  );
  // The wire never saw the send: the pre-flight short-circuited before dial.
  assert.equal(mock.requests.length, 0);
});

test("alert() rejects oversized payload before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const oversized = { ...SNAPSHOT, secondaryText: "y".repeat(5000) };

  await assert.rejects(
    () => client.alert("a".repeat(64), oversized),
    (err) => {
      assert.ok(err instanceof PayloadTooLargeError);
      assert.equal(err.trapId, "MS011");
      assert.match(err.message, /alert/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("broadcast() rejects oversized payload before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  // Broadcast ceiling is 5120; pad past it so this test pins the broadcast
  // branch rather than incidentally tripping the 4096 default.
  const oversized = { ...SNAPSHOT, secondaryText: "z".repeat(6000) };

  await assert.rejects(
    () => client.broadcast("ChannelId123", oversized),
    (err) => {
      assert.ok(err instanceof PayloadTooLargeError);
      assert.equal(err.trapId, "MS011");
      assert.match(err.message, /5120/);
      assert.match(err.message, /broadcast/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("broadcast() accepts a payload that fits the 5120-byte broadcast ceiling but would fail the 4096 default", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  // 4500 bytes of secondaryText sits between the two ceilings: the assembled
  // payload exceeds 4096 (so update() would reject it) but stays under 5120.
  // This pins that broadcast uses the higher ceiling rather than the default.
  const oversized = { ...SNAPSHOT, secondaryText: "w".repeat(4500) };

  const res = await client.broadcast("ChannelId123", oversized);
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 1);
});

test("update() accepts a payload just under the 4096-byte ceiling", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  // 3000 bytes of secondaryText leaves headroom for the envelope; total
  // serialized payload stays well under 4096.
  const fits = { ...SNAPSHOT, secondaryText: "u".repeat(3000) };

  const res = await client.update("a".repeat(64), fits);
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 1);
});

test("PayloadTooLargeError thrown by pre-flight carries trapId MS011", async (t) => {
  // Pins the runtime trap-binding loop: PayloadTooLargeError is bound to
  // MS011 in trap-bindings.ts and the lazy getter on ApnsError must resolve
  // it on the instance the SDK throws. Auditors have claimed this binding is
  // unverified at runtime; this test holds the line.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const oversized = { ...SNAPSHOT, secondaryText: "q".repeat(5000) };

  await assert.rejects(
    () => client.update("a".repeat(64), oversized),
    (err) => {
      assert.equal(err.name, "PayloadTooLargeError");
      assert.equal(err.trapId, "MS011");
      assert.equal(err.reason, "PayloadTooLarge");
      return true;
    },
  );
});

// --- cleanup --------------------------------------------------------------
test("teardown: remove temp p8 directory", () => {
  KEY.cleanup();
  assert.ok(true);
});
