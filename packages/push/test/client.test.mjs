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

// --- cleanup --------------------------------------------------------------
test("teardown: remove temp p8 directory", () => {
  KEY.cleanup();
  assert.ok(true);
});
