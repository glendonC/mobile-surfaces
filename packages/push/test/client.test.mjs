import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const {
  createPushClient,
  TEST_TRANSPORT_OVERRIDE,
  BadDeviceTokenError,
  BadExpirationDateError,
  BadDateError,
  ExpiredProviderTokenError,
  TooManyRequestsError,
  InvalidSnapshotError,
  ClientClosedError,
  MissingApnsConfigError,
  PayloadTooLargeError,
  FeatureNotEnabledError,
  ChannelNotRegisteredError,
  BadChannelIdError,
  CannotCreateChannelConfigError,
  UnknownApnsError,
  CreateChannelResponseError,
  AbortError,
  DEFAULT_RETRY_POLICY,
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

// Helper: produce a SNAPSHOT clone whose `liveActivity.body` is `ch` repeated
// `n` times. The MS011 payload-size tests use this to push past the 4 KB /
// 5 KB ceilings without other field changes. v4 lifted the rendering fields
// into the per-kind slice, so what was `{ ...SNAPSHOT, secondaryText: "x"... }`
// in v3-shape tests now nests under liveActivity.
function withBody(snap, ch, n) {
  return {
    ...snap,
    liveActivity: {
      ...snap.liveActivity,
      body: ch.repeat(n),
    },
  };
}

function makeClient({ sendOrigin, manageOrigin, retryPolicy } = {}) {
  return createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    _unsafeRetryOverride: retryPolicy,
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
    title: SNAPSHOT.liveActivity.title,
    body: SNAPSHOT.liveActivity.body,
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
    headline: SNAPSHOT.liveActivity.title,
    subhead: SNAPSHOT.liveActivity.body,
    progress: SNAPSHOT.liveActivity.progress,
    stage: SNAPSHOT.liveActivity.stage,
  });
});

// Phase 3 notification surface: contract has kind: "notification" and a
// toNotificationContentPayload helper that produces a wire-correct APNs
// alert payload (kind: "surface_notification" sidecar; aps.alert + optional
// category + thread-id). sendNotification() ships this end-to-end so the
// contract surface stops being half-promised. Same push-type / topic /
// priority as alert(); differs only in input kind and sidecar shape.

const NOTIFICATION_SNAPSHOT = (() => {
  // The committed JSON fixture carries a $schema link for editor tooling;
  // strip it before handing to the SDK so the strict Zod schema parses.
  const raw = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../data/surface-fixtures/notification-alert.json",
      ),
      "utf8",
    ),
  );
  delete raw.$schema;
  return raw;
})();

test("sendNotification() sends an alert push from a notification-kind snapshot", async (t) => {
  const mock = await startMockApns(() => ({
    status: 200,
    headers: { "apns-id": "notif-id-1" },
  }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const res = await client.sendNotification(
    "n".repeat(64),
    NOTIFICATION_SNAPSHOT,
    { apnsId: "notif-id-1" },
  );
  assert.equal(res.status, 200);

  const req = mock.requests[0];
  assert.equal(req.path, `/3/device/${"n".repeat(64)}`);
  assert.equal(req.headers["apns-push-type"], "alert");
  assert.equal(req.headers["apns-priority"], "10");
  // Bare bundle id — no .push-type.liveactivity suffix on a notification.
  assert.equal(req.headers["apns-topic"], "com.example.test");

  const body = JSON.parse(req.body);
  assert.deepEqual(body.aps.alert, {
    title: NOTIFICATION_SNAPSHOT.notification.title,
    body: NOTIFICATION_SNAPSHOT.notification.body,
  });
  assert.equal(body.aps.category, NOTIFICATION_SNAPSHOT.notification.category);
  assert.equal(body.aps["thread-id"], NOTIFICATION_SNAPSHOT.notification.threadId);
  assert.equal(body.liveSurface.kind, "surface_notification");
  assert.equal(body.liveSurface.snapshotId, NOTIFICATION_SNAPSHOT.id);
});

test("sendNotification() rejects a liveActivity-kind snapshot", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.sendNotification("n".repeat(64), SNAPSHOT),
    (err) => {
      assert.ok(err instanceof InvalidSnapshotError);
      assert.match(err.message, /notification-kind snapshot/);
      return true;
    },
  );
});

test("alert() rejects a notification-kind snapshot", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.alert("a".repeat(64), NOTIFICATION_SNAPSHOT),
    (err) => {
      assert.ok(err instanceof InvalidSnapshotError);
      assert.match(err.message, /liveActivity-kind snapshot/);
      return true;
    },
  );
});

test("alert() forwards collapseId as apns-collapse-id when supplied", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.alert("a".repeat(64), SNAPSHOT, { collapseId: "order-42" });
  const req = mock.requests[0];
  assert.equal(req.headers["apns-collapse-id"], "order-42");
});

test("update() does NOT forward collapseId (Apple ignores it on liveactivity)", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.update("a".repeat(64), SNAPSHOT, { collapseId: "should-not-appear" });
  const req = mock.requests[0];
  assert.equal(req.headers["apns-collapse-id"], undefined);
});

test("update() with relevanceScore forwards it into aps.relevance-score", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.update("a".repeat(64), SNAPSHOT, { relevanceScore: 0.75 });
  const req = mock.requests[0];
  const body = JSON.parse(req.body);
  assert.equal(body.aps["relevance-score"], 0.75);
});

test("update() without relevanceScore omits the field from aps", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.update("a".repeat(64), SNAPSHOT);
  const req = mock.requests[0];
  const body = JSON.parse(req.body);
  assert.ok(!("relevance-score" in body.aps));
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
  assert.equal(
    created.environment,
    "development",
    "createChannel() should stamp the client's environment on the returned ChannelInfo",
  );

  const list = await client.listChannels();
  assert.equal(list.length, 1);
  assert.equal(list[0].channelId, "newChannel==");
  assert.equal(
    list[0].environment,
    "development",
    "listChannels() entries should carry the client's environment",
  );
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

test("PushResult records first-try success with attempts=1 and empty retried", async (t) => {
  const mock = await startMockApns(() => ({ status: 200, headers: { "apns-id": "first-try" } }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const res = await client.alert("a".repeat(64), SNAPSHOT, { apnsId: "first-try" });
  assert.equal(res.attempts, 1);
  assert.deepEqual(res.retried, []);
  assert.deepEqual(res.trapHits, []);
  assert.equal(typeof res.latencyMs, "number");
  assert.ok(res.latencyMs >= 0, "latencyMs should be non-negative");
});

test("PushResult records each retried attempt with reason, status, and backoff", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls === 1) return { status: 503, body: { reason: "ServiceUnavailable" } };
    if (calls === 2) return { status: 500, body: { reason: "InternalServerError" } };
    return { status: 200, headers: { "apns-id": "ok-after-2" } };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  const res = await client.alert("b".repeat(64), SNAPSHOT, { apnsId: "ok-after-2" });
  assert.equal(res.attempts, 3);
  assert.equal(res.retried.length, 2);
  assert.equal(res.retried[0].reason, "ServiceUnavailable");
  assert.equal(res.retried[0].status, 503);
  assert.ok(res.retried[0].backoffMs >= 0);
  assert.equal(res.retried[1].reason, "InternalServerError");
  assert.equal(res.retried[1].status, 500);
  // Neither retried reason is bound to a trap; trapHits stays empty.
  assert.deepEqual(res.trapHits, []);
});

test("PushResult.trapHits dedupes trapIds touched across retries", async (t) => {
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
    return { status: 200, headers: { "apns-id": "after-throttle" } };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  const res = await client.alert("c".repeat(64), SNAPSHOT, { apnsId: "after-throttle" });
  assert.equal(res.attempts, 3);
  assert.deepEqual(
    res.retried.map((r) => r.trapId),
    ["MS015", "MS015"],
    "both retried attempts should carry the TooManyRequests trapId",
  );
  assert.deepEqual(res.trapHits, ["MS015"], "trapHits should dedupe");
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

test("priority 10 sends clamp maxRetries to 2 even when user policy allows more", async (t) => {
  // alert() defaults to priority 10. The user-configured retry policy
  // permits 5 retries, but the priority-aware stretch clamps to at most 2
  // (so the iOS budget is not torched on a single failure cascade).
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    return { status: 503, body: { reason: "ServiceUnavailable" } };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.alert("p10".repeat(20) + "a", SNAPSHOT),
    (err) => err.reason === "ServiceUnavailable",
  );
  // 1 initial + 2 retries (clamped) = 3 calls, not 6.
  assert.equal(calls, 3);
});

test("priority 5 sends keep the configured maxRetries", async (t) => {
  // update() defaults to priority 5; the priority-10 stretch should not
  // apply. User-configured maxRetries=4 ⇒ 5 total calls.
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    return { status: 503, body: { reason: "ServiceUnavailable" } };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 4, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("p5x".repeat(20) + "a", SNAPSHOT),
    (err) => err.reason === "ServiceUnavailable",
  );
  assert.equal(calls, 5);
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

  const broken = {
    ...SNAPSHOT,
    liveActivity: { ...SNAPSHOT.liveActivity, progress: "nope" },
  };
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
    {
      surfaceId: SNAPSHOT.surfaceId,
      modeLabel: SNAPSHOT.liveActivity.modeLabel,
    },
    { attributesType: "MyAttributes" },
  );
  const payload = JSON.parse(mock.requests[0].body);
  assert.equal(payload.aps.event, "start");
  assert.equal(payload.aps["attributes-type"], "MyAttributes");
  assert.deepEqual(payload.aps.attributes, {
    surfaceId: SNAPSHOT.surfaceId,
    modeLabel: SNAPSHOT.liveActivity.modeLabel,
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

// --- describeSend dry-run -------------------------------------------------

test("describeSend(alert) returns the request that would be sent without contacting APNs", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const description = client.describeSend({
    operation: "alert",
    deviceToken: "a".repeat(64),
    snapshot: SNAPSHOT,
    options: { apnsId: "fixed-id-describe" },
  });

  assert.equal(description.operation, "alert");
  assert.equal(description.method, "POST");
  assert.equal(description.path, `/3/device/${"a".repeat(64)}`);
  assert.equal(description.pushType, "alert");
  assert.equal(description.topic, "com.example.test");
  assert.equal(description.priority, 10);
  assert.equal(description.apnsId, "fixed-id-describe");
  assert.equal(description.snapshotKind, "liveActivity");
  assert.equal(description.target, "a".repeat(64));
  assert.equal(description.payloadJson, JSON.stringify(description.payload));
  assert.ok(description.payloadBytes > 0);
  assert.equal(description.payloadLimitBytes, 4096);
  assert.equal(description.withinLimit, true);

  // No network traffic.
  assert.equal(mock.requests.length, 0);
});

test("describeSend(update) targets the liveactivity push-type and per-activity topic", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const description = client.describeSend({
    operation: "update",
    activityToken: "b".repeat(64),
    snapshot: SNAPSHOT,
  });
  assert.equal(description.pushType, "liveactivity");
  assert.equal(description.topic, "com.example.test.push-type.liveactivity");
  assert.equal(description.priority, 5);
  assert.equal(description.payload.aps.event, "update");
});

test("describeSend(start) carries attributesType into the description", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const description = client.describeSend({
    operation: "start",
    pushToStartToken: "c".repeat(64),
    snapshot: SNAPSHOT,
    attributes: { surfaceId: SNAPSHOT.surfaceId },
    options: { attributesType: "MyAttrs" },
  });
  assert.equal(description.attributesType, "MyAttrs");
  assert.equal(description.payload.aps["attributes-type"], "MyAttrs");
  assert.deepEqual(description.payload.aps.attributes, {
    surfaceId: SNAPSHOT.surfaceId,
  });
});

test("describeSend(broadcast) uses the channel path with null topic and broadcast ceiling", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const description = client.describeSend({
    operation: "broadcast",
    channelId: "ChanXYZ",
    snapshot: SNAPSHOT,
  });
  assert.equal(description.path, "/4/broadcasts/apps/com.example.test");
  assert.equal(description.topic, null);
  assert.equal(description.channelId, "ChanXYZ");
  assert.equal(description.payloadLimitBytes, 5120);
  // Default storagePolicy is no-storage, which resolves apns-expiration to 0.
  assert.equal(description.expirationSeconds, 0);
});

test("describeSend(broadcast) matches a real broadcast() send for storagePolicy: 'no-storage'", async (t) => {
  // describeSend is documented as a side-effect-free preview of the exact
  // bytes a real send would issue. For a no-storage channel both paths must
  // resolve apns-expiration to 0.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const description = client.describeSend({
    operation: "broadcast",
    channelId: "ChanXYZ",
    snapshot: SNAPSHOT,
    options: { storagePolicy: "no-storage" },
  });
  await client.broadcast("ChanXYZ", SNAPSHOT, { storagePolicy: "no-storage" });

  const sent = Number(mock.requests[0].headers["apns-expiration"]);
  assert.equal(description.expirationSeconds, 0);
  assert.equal(
    description.expirationSeconds,
    sent,
    "describeSend expiration must equal what broadcast() actually sent",
  );
});

test("describeSend(broadcast) matches a real broadcast() send for storagePolicy: 'most-recent-message'", async (t) => {
  // For a most-recent-message channel resolveBroadcastExpiration returns a
  // nonzero TTL (now + 3600 when expirationSeconds is omitted). The earlier
  // bug hard-coded describeSend's broadcast preview to 0, so it disagreed with
  // the real send. Both paths now share resolveBroadcastExpiration; the only
  // gap is the wall-clock second each was evaluated in, so assert the preview
  // lands in the same now+3600 window the send used.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const before = Math.floor(Date.now() / 1000);
  const description = client.describeSend({
    operation: "broadcast",
    channelId: "ChanXYZ",
    snapshot: SNAPSHOT,
    options: { storagePolicy: "most-recent-message" },
  });
  await client.broadcast("ChanXYZ", SNAPSHOT, {
    storagePolicy: "most-recent-message",
  });
  const after = Math.floor(Date.now() / 1000);

  const sent = Number(mock.requests[0].headers["apns-expiration"]);
  assert.ok(
    description.expirationSeconds >= before + 3600 &&
      description.expirationSeconds <= after + 3600,
    `describeSend expiration ${description.expirationSeconds} should sit in [${before + 3600}, ${after + 3600}]`,
  );
  assert.ok(
    sent >= before + 3600 && sent <= after + 3600,
    `broadcast() expiration ${sent} should sit in [${before + 3600}, ${after + 3600}]`,
  );
  // Both derive from now + 3600; allow a 1s wall-clock slack between the two
  // evaluations rather than asserting byte-equality on a time-dependent value.
  assert.ok(
    Math.abs(description.expirationSeconds - sent) <= 1,
    `describeSend (${description.expirationSeconds}) and broadcast() (${sent}) should agree within 1s`,
  );
});

test("describeSend(broadcast) matches a real broadcast() send for an explicit expirationSeconds", async (t) => {
  // With an explicit expirationSeconds on a most-recent-message channel both
  // paths must echo the exact value byte-for-byte.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const options = {
    storagePolicy: "most-recent-message",
    expirationSeconds: 1893456000,
  };
  const description = client.describeSend({
    operation: "broadcast",
    channelId: "ChanXYZ",
    snapshot: SNAPSHOT,
    options,
  });
  await client.broadcast("ChanXYZ", SNAPSHOT, options);

  const sent = Number(mock.requests[0].headers["apns-expiration"]);
  assert.equal(description.expirationSeconds, 1893456000);
  assert.equal(description.expirationSeconds, sent);
});

test("describeSend validates the snapshot before describing", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  assert.throws(
    () => client.describeSend({ operation: "alert", deviceToken: "x", snapshot: WIDGET_SNAPSHOT }),
    (err) => {
      assert.ok(err instanceof InvalidSnapshotError);
      assert.match(err.message, /liveActivity/);
      return true;
    },
  );
});

test("describeSend reports withinLimit=false for an oversize payload without throwing", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const fat = withBody(SNAPSHOT, "x", 5000);
  const description = client.describeSend({
    operation: "alert",
    deviceToken: "d".repeat(64),
    snapshot: fat,
  });
  assert.ok(description.payloadBytes > 4096, "fixture should exceed 4 KB");
  assert.equal(description.withinLimit, false);
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
    _unsafeRetryOverride: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: false },
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
      // Server forcibly drops the h2 session mid-stream - equivalent to
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
      // The session itself stays alive - APNs / a proxy resetting one
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
    _unsafeRetryOverride: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
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
  // promise to all concurrent callers - otherwise the SDK would race-dial N
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

  // 5000 bytes of body alone clears the 4096 ceiling once the
  // ActivityKit envelope (aps, content-state, timestamp, etc.) is layered on.
  const oversized = withBody(SNAPSHOT, "x", 5000);

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

  const oversized = withBody(SNAPSHOT, "y", 5000);

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
  const oversized = withBody(SNAPSHOT, "z", 6000);

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

// --- broadcast expiration: storagePolicy validation (MS032) ---------------

test("broadcast() defaults to no-storage and emits apns-expiration: 0", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.broadcast("ChannelId123", SNAPSHOT);
  assert.equal(mock.requests[0].headers["apns-expiration"], "0");
});

test("broadcast() with storagePolicy: 'no-storage' and expirationSeconds: 0 still emits 0", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.broadcast("ChannelId123", SNAPSHOT, {
    storagePolicy: "no-storage",
    expirationSeconds: 0,
  });
  assert.equal(mock.requests[0].headers["apns-expiration"], "0");
});

test("broadcast() rejects nonzero expirationSeconds on a no-storage channel before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () =>
      client.broadcast("ChannelId123", SNAPSHOT, {
        storagePolicy: "no-storage",
        expirationSeconds: 1234567890,
      }),
    (err) => {
      assert.ok(err instanceof BadExpirationDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /no-storage/);
      assert.match(err.message, /1234567890/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("broadcast() rejects nonzero expirationSeconds when storagePolicy is omitted (defaults to no-storage)", async (t) => {
  // Before this change, expirationSeconds on broadcast() was silently
  // ignored (hardcoded to 0). Surfacing it as an error is the honest
  // transition: callers who set it were getting nothing useful and the
  // error message points them at storagePolicy.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () =>
      client.broadcast("ChannelId123", SNAPSHOT, {
        expirationSeconds: 99,
      }),
    (err) => {
      assert.ok(err instanceof BadExpirationDateError);
      assert.match(err.message, /storagePolicy/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("broadcast() with storagePolicy: 'most-recent-message' and explicit expirationSeconds emits that value", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.broadcast("ChannelId123", SNAPSHOT, {
    storagePolicy: "most-recent-message",
    expirationSeconds: 1893456000,
  });
  assert.equal(mock.requests[0].headers["apns-expiration"], "1893456000");
});

test("broadcast() with storagePolicy: 'most-recent-message' defaults expirationSeconds to ~now+3600 when omitted", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const before = Math.floor(Date.now() / 1000);
  await client.broadcast("ChannelId123", SNAPSHOT, {
    storagePolicy: "most-recent-message",
  });
  const after = Math.floor(Date.now() / 1000);

  const sent = Number(mock.requests[0].headers["apns-expiration"]);
  assert.ok(
    sent >= before + 3600 && sent <= after + 3600,
    `expected expiration in [${before + 3600}, ${after + 3600}], got ${sent}`,
  );
});

test("broadcast() rejects expirationSeconds: 0 on a most-recent-message channel", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () =>
      client.broadcast("ChannelId123", SNAPSHOT, {
        storagePolicy: "most-recent-message",
        expirationSeconds: 0,
      }),
    (err) => {
      assert.ok(err instanceof BadExpirationDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /most-recent-message/);
      assert.match(err.message, /defeats/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

// --- Live Activity timestamp validation (MS032) --------------------------
//
// staleDateSeconds / dismissalDateSeconds / expirationSeconds must be
// positive unix-seconds integers. The SDK rejects malformed values before
// any network call, mirroring scripts/send-apns.mjs's parseUnixSeconds and
// the MS032 catalog claim that "the SDK already enforces this". stale and
// dismissal map to BadDateError; expiration maps to BadExpirationDateError.
// Both classes carry trapId "MS032".

test("update() rejects a non-integer staleDateSeconds before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("a".repeat(64), SNAPSHOT, { staleDateSeconds: 1700000000.5 }),
    (err) => {
      assert.ok(err instanceof BadDateError);
      assert.equal(err.status, 400);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /staleDateSeconds/);
      assert.match(err.message, /integer/);
      assert.match(err.message, /MS032/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("update() rejects a negative dismissalDateSeconds before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("a".repeat(64), SNAPSHOT, { dismissalDateSeconds: -5 }),
    (err) => {
      assert.ok(err instanceof BadDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /dismissalDateSeconds/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("update() rejects a zero staleDateSeconds before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("a".repeat(64), SNAPSHOT, { staleDateSeconds: 0 }),
    (err) => {
      assert.ok(err instanceof BadDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /staleDateSeconds/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("update() rejects a NaN staleDateSeconds before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("a".repeat(64), SNAPSHOT, { staleDateSeconds: Number.NaN }),
    (err) => {
      assert.ok(err instanceof BadDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /finite/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("update() rejects a millisecond-magnitude staleDateSeconds before any network call", async (t) => {
  // Date.now() returns ~1.7e12; passing it where unix seconds are expected is
  // the single most common MS032 offender. parseUnixSeconds in send-apns.mjs
  // would accept it (still a positive integer) but APNs would not, so the SDK
  // is intentionally stricter here.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("a".repeat(64), SNAPSHOT, { staleDateSeconds: Date.now() }),
    (err) => {
      assert.ok(err instanceof BadDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /millisecond/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("alert() rejects a millisecond-magnitude expirationSeconds with BadExpirationDateError", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.alert("a".repeat(64), SNAPSHOT, { expirationSeconds: Date.now() }),
    (err) => {
      assert.ok(err instanceof BadExpirationDateError);
      assert.equal(err.status, 400);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /expirationSeconds/);
      assert.match(err.message, /millisecond/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("update() rejects a non-integer expirationSeconds with BadExpirationDateError", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("a".repeat(64), SNAPSHOT, { expirationSeconds: 1700000000.25 }),
    (err) => {
      assert.ok(err instanceof BadExpirationDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /expirationSeconds/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("start() rejects a negative staleDateSeconds before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () =>
      client.start("c".repeat(64), SNAPSHOT, { surfaceId: SNAPSHOT.surfaceId }, {
        staleDateSeconds: -1,
      }),
    (err) => {
      assert.ok(err instanceof BadDateError);
      assert.equal(err.trapId, "MS032");
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("end() rejects a millisecond-magnitude dismissalDateSeconds before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.end("b".repeat(64), SNAPSHOT, { dismissalDateSeconds: Date.now() }),
    (err) => {
      assert.ok(err instanceof BadDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /dismissalDateSeconds/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("broadcast() rejects a non-integer staleDateSeconds before any network call", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.broadcast("ChannelId123", SNAPSHOT, { staleDateSeconds: 1700000000.5 }),
    (err) => {
      assert.ok(err instanceof BadDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /staleDateSeconds/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("broadcast() rejects a millisecond-magnitude expirationSeconds before any network call", async (t) => {
  // A nonzero expirationSeconds on a broadcast is still subject to MS032
  // integer/magnitude validation; the zero-vs-storagePolicy decision is
  // resolveBroadcastExpiration's job and is exercised separately above.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () =>
      client.broadcast("ChannelId123", SNAPSHOT, {
        storagePolicy: "most-recent-message",
        expirationSeconds: Date.now(),
      }),
    (err) => {
      assert.ok(err instanceof BadExpirationDateError);
      assert.equal(err.trapId, "MS032");
      assert.match(err.message, /expirationSeconds/);
      assert.match(err.message, /millisecond/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 0);
});

test("update() accepts expirationSeconds: 0 and emits apns-expiration: 0", async (t) => {
  // expirationSeconds: 0 is a documented, valid apns-expiration value
  // ("attempt delivery once, do not store") and worked before the MS032
  // pre-flight landed. assertActivityTimestampOptions must let a zero through
  // on device sends, exactly as broadcast() already does.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.update("b".repeat(64), SNAPSHOT, { expirationSeconds: 0 });
  assert.equal(mock.requests[0].headers["apns-expiration"], "0");
});

test("alert() accepts expirationSeconds: 0 and emits apns-expiration: 0", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await client.alert("a".repeat(64), SNAPSHOT, { expirationSeconds: 0 });
  assert.equal(mock.requests[0].headers["apns-expiration"], "0");
});

test("describeSend rejects a malformed timestamp the same as the real send (MS032)", async (t) => {
  // describeSend must reject exactly the timestamp inputs #sendDevice and
  // broadcast() reject, or the preview greenlights a payload the runtime
  // would refuse. Covers both the device branch and the broadcast branch.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  assert.throws(
    () =>
      client.describeSend({
        operation: "update",
        activityToken: "b".repeat(64),
        snapshot: SNAPSHOT,
        options: { staleDateSeconds: 1700000000.5 },
      }),
    (err) => err instanceof BadDateError && err.trapId === "MS032",
  );

  assert.throws(
    () =>
      client.describeSend({
        operation: "broadcast",
        channelId: "ChannelId123",
        snapshot: SNAPSHOT,
        options: {
          storagePolicy: "most-recent-message",
          expirationSeconds: Date.now(),
        },
      }),
    (err) => err instanceof BadExpirationDateError && err.trapId === "MS032",
  );

  assert.equal(mock.requests.length, 0);
});

test("describeSend accepts expirationSeconds: 0 like the real send", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const description = client.describeSend({
    operation: "update",
    activityToken: "b".repeat(64),
    snapshot: SNAPSHOT,
    options: { expirationSeconds: 0 },
  });
  assert.equal(description.expirationSeconds, 0);
});

test("valid unix-seconds timestamp fields pass through to the wire untouched", async (t) => {
  // The valid-passthrough case: integer, positive, second-magnitude values
  // for every timestamp field reach APNs unchanged.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const stale = 1893456000;
  const expiration = 1893456600;
  await client.update("a".repeat(64), SNAPSHOT, {
    staleDateSeconds: stale,
    expirationSeconds: expiration,
  });

  const req = mock.requests[0];
  assert.equal(req.headers["apns-expiration"], String(expiration));
  const payload = JSON.parse(req.body);
  assert.equal(payload.aps["stale-date"], stale);
});

test("broadcast() accepts a payload that fits the 5120-byte broadcast ceiling but would fail the 4096 default", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  // 4500 bytes of body sits between the two ceilings: the assembled
  // payload exceeds 4096 (so update() would reject it) but stays under 5120.
  // This pins that broadcast uses the higher ceiling rather than the default.
  const oversized = withBody(SNAPSHOT, "w", 4500);

  const res = await client.broadcast("ChannelId123", oversized);
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 1);
});

test("update() accepts a payload just under the 4096-byte ceiling", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  // 3000 bytes of body leaves headroom for the envelope; total
  // serialized payload stays well under 4096.
  const fits = withBody(SNAPSHOT, "u", 3000);

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

  const oversized = withBody(SNAPSHOT, "q", 5000);

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

// --- retry policy override naming + env kill-switch ---------------------

test("legacy retryPolicy option still applies but logs a one-time deprecation", async (t) => {
  // Tests cohabit a single Node process; the deprecation flag is set lazily
  // on first use of the legacy field. Reset stderr capture, instantiate
  // twice, assert the warning fired exactly once.
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  t.after(() => {
    console.warn = origWarn;
  });

  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    return { status: 503, body: { reason: "ServiceUnavailable" } };
  });
  t.after(() => mock.close());

  const legacy1 = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    idleTimeoutMs: 1_000,
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin: mock.origin },
  });
  const legacy2 = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    retryPolicy: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    idleTimeoutMs: 1_000,
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin: mock.origin },
  });
  t.after(async () => {
    await legacy1.close();
    await legacy2.close();
  });

  // update() is priority 5 - the priority-10 stretch will not interfere
  // with the user-set maxRetries=1.
  await assert.rejects(() => legacy1.update("d".repeat(64), SNAPSHOT));
  assert.equal(calls, 2, "legacy retryPolicy=maxRetries:1 should yield 2 calls");

  const deprecation = warnings.find((w) => w.includes("_unsafeRetryOverride"));
  assert.ok(deprecation, "expected a deprecation warning naming the new option");
  const occurrences = warnings.filter((w) =>
    w.includes("_unsafeRetryOverride"),
  ).length;
  assert.equal(occurrences, 1, "deprecation should fire at most once per process");
});

test("MOBILE_SURFACES_PUSH_DISABLE_RETRY=1 forces maxRetries to 0", async (t) => {
  const before = process.env.MOBILE_SURFACES_PUSH_DISABLE_RETRY;
  process.env.MOBILE_SURFACES_PUSH_DISABLE_RETRY = "1";
  t.after(() => {
    if (before === undefined) {
      delete process.env.MOBILE_SURFACES_PUSH_DISABLE_RETRY;
    } else {
      process.env.MOBILE_SURFACES_PUSH_DISABLE_RETRY = before;
    }
  });

  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    return { status: 503, body: { reason: "ServiceUnavailable" } };
  });
  // Even with a generous override, the env kill-switch wins.
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    _unsafeRetryOverride: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
    idleTimeoutMs: 1_000,
    [TEST_TRANSPORT_OVERRIDE]: { sendOrigin: mock.origin },
  });
  teardown(t, client, mock);

  await assert.rejects(() => client.update("e".repeat(64), SNAPSHOT));
  assert.equal(calls, 1, "env kill-switch should force a single attempt");
});

// --- JWT refresh on retry (MS030) ----------------------------------------
//
// The SDK refreshes the bearer header from this.#jwt.get() after every
// backoff sleep (client.ts around the `headers.authorization = ...` line).
// JwtCache returns a cached token until refreshIntervalMs elapses; once it
// elapses, the next get() re-mints with a fresh iat. The test seam plumbed
// through TEST_TRANSPORT_OVERRIDE drives the cache's refreshIntervalMs and
// now() so the retry path observably re-mints between attempts without
// needing to wait out the 50-minute production window.

function decodeJwtIat(jwt) {
  const [, payload] = jwt.split(".");
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")).iat;
}

test("ExpiredProviderToken retry re-mints the JWT with a later iat", async (t) => {
  // Apple returns 403 ExpiredProviderToken when the JWT's iat is older than
  // 60min. The SDK's contract (and reasons.ts comment) is: refresh JWTs every
  // 50min; if APNs rejects with ExpiredProviderToken anyway, the next retry
  // mints a fresh token. This test pins the refresh: capture the bearer on
  // each attempt and assert the second mint carries a strictly-greater iat.
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls === 1) {
      return {
        status: 403,
        headers: { "apns-id": "expired-1" },
        body: { reason: "ExpiredProviderToken" },
      };
    }
    return { status: 200, headers: { "apns-id": "ok-after-refresh" } };
  });
  // Drive a virtual clock so the second mint lands at iat = first + 1, well
  // past the configured 10ms refresh window. The cache's nowMs - iatMs check
  // sees 1000ms elapsed and re-mints synchronously inside get().
  let virtualNowMs = 1_700_000_000_000;
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 1_000,
    _unsafeRetryOverride: {
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 2,
      jitter: false,
      // ExpiredProviderToken is not in DEFAULT_RETRYABLE_REASONS; widen so
      // the SDK retries it. The refresh-on-retry path runs regardless of
      // which reason triggered the retry.
      retryableReasons: new Set(["ExpiredProviderToken"]),
    },
    [TEST_TRANSPORT_OVERRIDE]: {
      sendOrigin: mock.origin,
      jwtRefreshIntervalMs: 10,
      jwtNow: () => virtualNowMs,
    },
  });
  teardown(t, client, mock);

  // Bump the virtual clock past refreshIntervalMs before the second attempt.
  // The retry path calls this.#jwt.get() after sleep; with the bumped clock,
  // the cache treats the first entry as stale and re-mints.
  const origSleep = global.setTimeout;
  // Bump the clock when the SDK schedules its backoff sleep. setTimeout is
  // the only async wait between the rejected first attempt and the JWT
  // refresh call, so it's a reliable hook.
  global.setTimeout = (fn, ms, ...rest) => {
    virtualNowMs += 1000;
    return origSleep(fn, ms, ...rest);
  };
  t.after(() => {
    global.setTimeout = origSleep;
  });

  const res = await client.alert("a".repeat(64), SNAPSHOT, {
    apnsId: "ok-after-refresh",
  });
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);

  // Two distinct bearer tokens were sent. The iat second on attempt 2 must
  // be strictly greater than attempt 1, proving a fresh mint happened.
  const auth1 = String(mock.requests[0].headers.authorization).replace(
    /^bearer /,
    "",
  );
  const auth2 = String(mock.requests[1].headers.authorization).replace(
    /^bearer /,
    "",
  );
  assert.notEqual(auth1, auth2, "bearer must differ between attempts");
  const iat1 = decodeJwtIat(auth1);
  const iat2 = decodeJwtIat(auth2);
  assert.ok(
    iat2 > iat1,
    `iat must advance across refresh (iat1=${iat1}, iat2=${iat2})`,
  );
});

test("JwtCache returns the cached token across retries when the window has not elapsed", async (t) => {
  // Counter-test to the refresh case above: if backoff stays well inside the
  // refresh window, the SDK must NOT re-mint - it should send the same bearer
  // on every attempt. Pins that the refresh path is gated by the cache's
  // freshness check rather than firing unconditionally on every retry.
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls === 1) {
      return { status: 503, body: { reason: "ServiceUnavailable" } };
    }
    return { status: 200 };
  });
  const fixedNowMs = 1_700_000_000_000;
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: KEY.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 1_000,
    _unsafeRetryOverride: {
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 2,
      jitter: false,
    },
    [TEST_TRANSPORT_OVERRIDE]: {
      sendOrigin: mock.origin,
      // 50-minute window, virtual clock frozen: cache stays fresh across
      // the whole test.
      jwtRefreshIntervalMs: 50 * 60 * 1000,
      jwtNow: () => fixedNowMs,
    },
  });
  teardown(t, client, mock);

  const res = await client.alert("a".repeat(64), SNAPSHOT);
  assert.equal(res.status, 200);
  assert.equal(mock.requests.length, 2);
  const auth1 = mock.requests[0].headers.authorization;
  const auth2 = mock.requests[1].headers.authorization;
  assert.equal(auth1, auth2, "bearer must be identical when window has not elapsed");
});

// End-to-end ExpiredProviderToken recovery with the production defaults.
// The two tests above exercise the JWT-refresh seam via TEST_TRANSPORT_OVERRIDE
// knobs (custom refreshIntervalMs, virtual now()); this one pins the path a
// real deployment actually walks: APNs rejects a still-fresh bearer with 403
// ExpiredProviderToken (the clock-skew variant of MS030), the SDK must
// invalidate the cache and re-mint regardless of whether the 50-minute window
// has elapsed locally, and the retry succeeds on the same client.alert()
// call. No retryableReasons widening, no jwtRefreshIntervalMs override — the
// behavior must hold with the default policy because that's what production
// callers run.
test("ExpiredProviderToken on first attempt invalidates JWT cache and recovers via retry", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls === 1) {
      return {
        status: 403,
        headers: { "apns-id": "expired-default" },
        body: { reason: "ExpiredProviderToken" },
      };
    }
    return { status: 200, headers: { "apns-id": "ok-after-mint" } };
  });
  // Production-default policy: no retryableReasons override. baseDelayMs is
  // tightened so the test finishes quickly, but ExpiredProviderToken must be
  // retried purely on the strength of being in DEFAULT_RETRYABLE_REASONS.
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { baseDelayMs: 1, maxDelayMs: 2, jitter: false },
  });
  teardown(t, client, mock);

  const res = await client.alert("a".repeat(64), SNAPSHOT, {
    apnsId: "ok-after-mint",
  });

  // PushResult contract: attempts counts the successful send too, so a single
  // retry-then-succeed lands at attempts=2 with one entry in retried[].
  assert.equal(res.status, 200);
  assert.equal(res.attempts, 2);
  assert.equal(res.retried.length, 1);
  assert.equal(res.retried[0].reason, "ExpiredProviderToken");
  assert.equal(res.retried[0].status, 403);
  assert.equal(res.retried[0].trapId, "MS030");
  // ExpiredProviderTokenError carries the MS030 binding; trapHits dedupes
  // across retries so a single hit lands as one entry.
  assert.deepEqual(res.trapHits, ["MS030"]);

  // Wire-level proof of the re-mint: the mock observed two distinct
  // authorization headers across the two attempts. Without the JwtCache
  // invalidation in client.ts, get() returns the same cached token on the
  // retry (because the 50-minute window has not elapsed locally) and the
  // bearer on attempt 2 would equal the bearer on attempt 1.
  assert.equal(mock.requests.length, 2);
  const auth1 = String(mock.requests[0].headers.authorization);
  const auth2 = String(mock.requests[1].headers.authorization);
  assert.match(auth1, /^bearer /);
  assert.match(auth2, /^bearer /);
  assert.notEqual(
    auth1,
    auth2,
    "JwtCache must re-mint after ExpiredProviderToken; same bearer on attempt 2 means the cache was not invalidated",
  );
});

test("ExpiredProviderToken exhausts retries and surfaces ExpiredProviderTokenError to the caller", async (t) => {
  // Counter-test: if every attempt fails with ExpiredProviderToken (Apple
  // still rejecting the freshly-minted bearer — e.g. host clock badly skewed,
  // not just a one-off mid-flight expiry), the SDK must surface the typed
  // error rather than looping forever. Pins that the retry path is bounded by
  // maxRetries and the final error carries the MS030 binding for operator
  // dashboards.
  const mock = await startMockApns(() => ({
    status: 403,
    headers: { "apns-id": "expired-loop" },
    body: { reason: "ExpiredProviderToken" },
  }));
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: false },
  });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.alert("a".repeat(64), SNAPSHOT),
    (err) => {
      assert.ok(err instanceof ExpiredProviderTokenError);
      assert.equal(err.reason, "ExpiredProviderToken");
      assert.equal(err.status, 403);
      assert.equal(err.trapId, "MS030");
      return true;
    },
  );
  // 1 initial + 2 retries = 3 calls.
  assert.equal(mock.requests.length, 3);
});

// --- broadcast / channel-admin failure modes (MS031, MS034) --------------
//
// Happy-path coverage for broadcast / createChannel / listChannels /
// deleteChannel lives earlier in this file. These tests pin the typed-error
// surface end-to-end: a non-2xx APNs response with a known reason string
// should throw the matching ApnsError subclass, carry the catalog trapId,
// expose a docsUrl, and embed the reason guide's operator-facing Fix copy.

test("broadcast() 403 FeatureNotEnabled throws FeatureNotEnabledError with MS034 binding", async (t) => {
  const mock = await startMockApns(() => ({
    status: 403,
    headers: { "apns-id": "fne-1" },
    body: { reason: "FeatureNotEnabled" },
  }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.broadcast("ChannelXYZ", SNAPSHOT),
    (err) => {
      assert.ok(err instanceof FeatureNotEnabledError);
      assert.equal(err.reason, "FeatureNotEnabled");
      assert.equal(err.status, 403);
      assert.equal(err.apnsId, "fne-1");
      assert.equal(err.trapId, "MS034");
      assert.ok(err.docsUrl, "docsUrl should resolve from the MS034 binding");
      assert.match(err.docsUrl, /ms034/);
      // The base ApnsError formatter embeds the reasons.ts guide entry.
      assert.match(err.message, /Fix:/);
      assert.match(err.message, /Broadcast/);
      return true;
    },
  );
});

test("broadcast() 410 ChannelNotRegistered throws ChannelNotRegisteredError with MS031 binding", async (t) => {
  const mock = await startMockApns(() => ({
    status: 410,
    headers: { "apns-id": "cnr-1" },
    body: { reason: "ChannelNotRegistered" },
  }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.broadcast("ChannelNoSuch", SNAPSHOT),
    (err) => {
      assert.ok(err instanceof ChannelNotRegisteredError);
      assert.equal(err.reason, "ChannelNotRegistered");
      assert.equal(err.status, 410);
      assert.equal(err.apnsId, "cnr-1");
      assert.equal(err.trapId, "MS031");
      assert.ok(err.docsUrl, "docsUrl should resolve from the MS031 binding");
      assert.match(err.docsUrl, /ms031/);
      assert.match(err.message, /Fix:/);
      // Channels are environment-scoped - the reason guide names that
      // operationally. Catch a regression that drops the guide text.
      assert.match(err.message, /environment-scoped/);
      return true;
    },
  );
});

test("createChannel() 400 BadChannelId throws BadChannelIdError with MS031 binding", async (t) => {
  const mock = await startMockApns(() => ({
    status: 400,
    headers: { "apns-id": "bci-1" },
    body: { reason: "BadChannelId" },
  }));
  const client = makeClient({ manageOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.createChannel({ storagePolicy: "no-storage" }),
    (err) => {
      assert.ok(err instanceof BadChannelIdError);
      assert.equal(err.reason, "BadChannelId");
      assert.equal(err.status, 400);
      assert.equal(err.apnsId, "bci-1");
      assert.equal(err.trapId, "MS031");
      assert.ok(err.docsUrl, "docsUrl should resolve from the MS031 binding");
      assert.match(err.message, /Fix:/);
      assert.match(err.message, /base64/);
      return true;
    },
  );
});

test("createChannel() 400 CannotCreateChannelConfig throws CannotCreateChannelConfigError", async (t) => {
  // CannotCreateChannelConfigError is intentionally NOT bound to a trap in
  // trap-bindings.ts (the MS031 errorClasses list excludes it; the cap-reached
  // failure mode is operational, not a Mobile Surfaces silent-fail trap). The
  // typed class still has to surface so callers can pattern-match on it; this
  // test pins that contract and the absence of a catalog binding.
  const mock = await startMockApns(() => ({
    status: 400,
    headers: { "apns-id": "ccc-1" },
    body: { reason: "CannotCreateChannelConfig" },
  }));
  const client = makeClient({ manageOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.createChannel({ storagePolicy: "no-storage" }),
    (err) => {
      assert.ok(err instanceof CannotCreateChannelConfigError);
      assert.equal(err.reason, "CannotCreateChannelConfig");
      assert.equal(err.status, 400);
      assert.equal(err.apnsId, "ccc-1");
      assert.equal(err.trapId, undefined, "unbound class returns undefined trapId");
      assert.equal(err.docsUrl, undefined);
      assert.match(err.message, /Fix:/);
      assert.match(err.message, /10,000 channels/);
      return true;
    },
  );
});

// --- 5xx-with-empty-body retry (v5 audit fix 2.1) ------------------------
//
// Before v5, a bare 5xx with no parseable JSON body became
// UnknownApnsError(reason="Unknown"), which is not in DEFAULT_RETRYABLE_REASONS,
// so the SDK gave up after one attempt. The audit fix retries any response
// with status >= 500 regardless of parsed reason. The terminal-reasons guard
// still keeps caller-customized retry sets from re-enabling retries on
// permanently broken tokens.

test("500 with empty body is retried up to the default maxRetries", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    // No body, no headers - the worst-case shape that previously short-
    // circuited the retry loop. UnknownApnsError(reason="Unknown") would
    // surface; the v5 fix retries it because status >= 500.
    return { status: 500 };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.update("a".repeat(64), SNAPSHOT),
    (err) => {
      assert.ok(err instanceof UnknownApnsError);
      assert.equal(err.status, 500);
      assert.equal(err.reason, "Unknown");
      return true;
    },
  );
  // 1 initial + 3 retries = 4 calls. If the audit fix regressed, calls would
  // be 1 (no retries) because UnknownApnsError is not in retryableReasons.
  assert.equal(calls, 4);
});

test("503 with empty body is retried (transport-level 5xx fallthrough)", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    if (calls <= 2) return { status: 503 };
    return { status: 200, headers: { "apns-id": "after-503" } };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  const res = await client.update("b".repeat(64), SNAPSHOT, {
    apnsId: "after-503",
  });
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
});

test("400 with empty body (UnknownApnsError, non-5xx) is NOT retried", async (t) => {
  // Negative case: only 5xx responses qualify for the "Unknown reason"
  // fallthrough. A 4xx without a parseable body is a caller error - retrying
  // it would amplify load without changing the outcome.
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    return { status: 400 };
  });
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: false },
  });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.alert("c".repeat(64), SNAPSHOT),
    (err) => {
      assert.ok(err instanceof UnknownApnsError);
      assert.equal(err.status, 400);
      assert.equal(err.reason, "Unknown");
      return true;
    },
  );
  assert.equal(calls, 1, "4xx with Unknown reason must not retry");
});

// --- createChannel typed-error for unparseable response (v5 audit fix 2.4)

test("createChannel throws CreateChannelResponseError when channel id is missing from headers + body", async (t) => {
  const mock = await startMockApns(() => ({
    status: 201,
    body: { foo: "bar" }, // no apns-channel-id / channel-id / channelId
  }));
  const client = makeClient({ manageOrigin: mock.origin });
  teardown(t, client, mock);

  await assert.rejects(
    () => client.createChannel({ storagePolicy: "no-storage" }),
    (err) => {
      assert.ok(err instanceof CreateChannelResponseError);
      assert.equal(err.status, 201);
      assert.match(err.message, /no apns-channel-id was found/);
      return true;
    },
  );
});

// --- AbortSignal support (v5 audit fix 2.3) ------------------------------

test("aborting mid-request rejects with AbortError", async (t) => {
  let release;
  const mock = await startMockApns(() => {
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const controller = new AbortController();
  const inflight = client.alert("a".repeat(64), SNAPSHOT, {
    signal: controller.signal,
  });
  // Give the request a tick to dispatch before aborting.
  await new Promise((res) => setTimeout(res, 10));
  controller.abort();
  // Release the hung response so the server can clean up - by this point the
  // client has already cancelled the stream.
  release?.({ status: 200 });

  await assert.rejects(
    inflight,
    (err) => {
      assert.ok(err instanceof AbortError, `expected AbortError, got ${err?.name}`);
      return true;
    },
  );
});

test("aborting during a retry-backoff sleep rejects with AbortError", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    return { status: 503, body: { reason: "ServiceUnavailable" } };
  });
  // Generous backoff so the abort lands while the SDK is sleeping between
  // attempts rather than during the in-flight request.
  const client = makeClient({
    sendOrigin: mock.origin,
    retryPolicy: { maxRetries: 5, baseDelayMs: 500, maxDelayMs: 5000, jitter: false },
  });
  teardown(t, client, mock);

  const controller = new AbortController();
  const inflight = client.update("b".repeat(64), SNAPSHOT, {
    signal: controller.signal,
  });
  // Wait long enough for the first attempt to complete and enter backoff,
  // but well under the 500ms base delay.
  await new Promise((res) => setTimeout(res, 100));
  controller.abort();

  await assert.rejects(
    inflight,
    (err) => err instanceof AbortError,
  );
  // One attempt completed; the backoff sleep was aborted before the retry
  // could dispatch.
  assert.equal(calls, 1);
});

test("aborting after a successful response is a no-op", async (t) => {
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const controller = new AbortController();
  const res = await client.alert("c".repeat(64), SNAPSHOT, {
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  controller.abort(); // No reject, no throw - the request already completed.
});

test("an already-aborted signal rejects immediately without dialing", async (t) => {
  let calls = 0;
  const mock = await startMockApns(() => {
    calls += 1;
    return { status: 200 };
  });
  const client = makeClient({ sendOrigin: mock.origin });
  teardown(t, client, mock);

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      client.alert("d".repeat(64), SNAPSHOT, { signal: controller.signal }),
    (err) => err instanceof AbortError,
  );
  // No request reached the wire.
  assert.equal(calls, 0);
  assert.equal(mock.sessionCount, 0);
});

test("AbortSignal plumbs through createChannel/listChannels/deleteChannel", async (t) => {
  // Coverage smoke for the management methods: an already-aborted signal
  // makes each method reject without contacting APNs. The send path's full
  // mid-flight + mid-backoff coverage above pins the deeper behavior.
  const mock = await startMockApns(() => ({ status: 200 }));
  const client = makeClient({ manageOrigin: mock.origin });
  teardown(t, client, mock);

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => client.createChannel({ signal: controller.signal }),
    (err) => err instanceof AbortError,
  );
  await assert.rejects(
    () => client.listChannels({ signal: controller.signal }),
    (err) => err instanceof AbortError,
  );
  await assert.rejects(
    () => client.deleteChannel("abc==", { signal: controller.signal }),
    (err) => err instanceof AbortError,
  );
});

// --- cleanup --------------------------------------------------------------
test("teardown: remove temp p8 directory", () => {
  KEY.cleanup();
  assert.ok(true);
});
