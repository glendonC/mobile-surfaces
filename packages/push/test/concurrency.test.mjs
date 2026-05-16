// Cap + queue behavior for Http2Client: peer-aware concurrent-stream limit,
// FIFO queue when the cap is full, abort/close/listener-hygiene semantics on
// queued requests. Mirrors Agent 2's design in the v8 push-hardening plan.

import { test } from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";

const { Http2Client } = await import("../dist/http.js");

import { startMockApns } from "./fixtures/mock-apns.mjs";

const connectInsecure = (origin, options) =>
  http2.connect(origin, { ...(options ?? {}) });

// Build a mock APNs whose handler holds responses until the test releases
// them. Lets us pin precisely how many streams are concurrently in flight
// at any moment.
function startReleasableMock(peerSettings) {
  const releaseQueue = [];
  const requestArrived = [];
  let waitForArrival = null;
  return startMockApns(
    (_req) =>
      new Promise((resolve) => {
        releaseQueue.push(() => resolve({ status: 200, body: "{}" }));
        if (waitForArrival) {
          const fn = waitForArrival;
          waitForArrival = null;
          fn();
        } else {
          requestArrived.push(true);
        }
      }),
    peerSettings ? { settings: peerSettings } : undefined,
  ).then((mock) => ({
    ...mock,
    /** Resolve the head pending stream. */
    releaseOne() {
      const fn = releaseQueue.shift();
      if (fn) fn();
    },
    /** Resolve every pending stream. */
    releaseAll() {
      while (releaseQueue.length > 0) releaseQueue.shift()();
    },
    /** Wait until at least one new request reaches the server. */
    awaitArrival() {
      return new Promise((res) => {
        if (requestArrived.length > 0) {
          requestArrived.shift();
          res();
          return;
        }
        waitForArrival = res;
      });
    },
    get pendingCount() {
      return releaseQueue.length;
    },
  }));
}

test("cap honors peer SETTINGS_MAX_CONCURRENT_STREAMS", async (t) => {
  const mock = await startReleasableMock({ maxConcurrentStreams: 2 });
  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 60_000,
    connect: connectInsecure,
  });
  t.after(async () => {
    mock.releaseAll();
    await client.close();
    await mock.close();
  });

  // Warmup: dispatch one request and let it complete so the HTTP/2 session
  // is established AND the peer's SETTINGS frame has been received. Without
  // this, a tight burst can race the SETTINGS frame; the SDK then dispatches
  // against the defensive floor (900) instead of the peer's advertised cap.
  const warmup = client.request({
    headers: { ":method": "POST", ":path": "/3/device/warmup" },
    body: "{}",
  });
  await mock.awaitArrival();
  mock.releaseOne();
  await warmup;

  // Fire 5 requests; the peer's cap is 2, so at most 2 should ever be
  // simultaneously open against the server.
  const requests = [];
  for (let i = 0; i < 5; i++) {
    requests.push(
      client.request({
        headers: { ":method": "POST", ":path": `/3/device/${i}` },
        body: "{}",
      }),
    );
  }

  // Give the first wave time to dispatch.
  await mock.awaitArrival();
  await mock.awaitArrival();
  // The cap should hold the third onward in the SDK's queue.
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(mock.pendingCount, 2, "only 2 streams should reach the peer at once");

  // Drain the queue in order.
  for (let i = 0; i < 5; i++) {
    mock.releaseOne();
    // Brief tick so the next queued request can advance.
    await new Promise((res) => setTimeout(res, 10));
  }
  await Promise.all(requests);
});

test("user cap stricter than peer wins", async (t) => {
  // Peer allows 10; the SDK is asked to cap at 1, so requests must serialize.
  const mock = await startReleasableMock({ maxConcurrentStreams: 10 });
  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 60_000,
    maxConcurrentStreams: 1,
    connect: connectInsecure,
  });
  t.after(async () => {
    mock.releaseAll();
    await client.close();
    await mock.close();
  });

  const requests = [];
  for (let i = 0; i < 4; i++) {
    requests.push(
      client.request({
        headers: { ":method": "POST", ":path": `/3/device/${i}` },
        body: "{}",
      }),
    );
  }

  await mock.awaitArrival();
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(mock.pendingCount, 1, "user cap of 1 must serialize requests");

  for (let i = 0; i < 4; i++) {
    mock.releaseOne();
    await new Promise((res) => setTimeout(res, 10));
  }
  await Promise.all(requests);
});

test("queued abort short-circuits without dispatching a stream", async (t) => {
  const mock = await startReleasableMock({ maxConcurrentStreams: 1 });
  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 60_000,
    connect: connectInsecure,
  });
  t.after(async () => {
    mock.releaseAll();
    await client.close();
    await mock.close();
  });

  // Fill the cap with one in-flight request.
  const inFlight = client.request({
    headers: { ":method": "POST", ":path": "/3/device/in-flight" },
    body: "{}",
  });
  await mock.awaitArrival();

  // Enqueue a second request with an AbortController.
  const ac = new AbortController();
  const queued = client.request({
    headers: { ":method": "POST", ":path": "/3/device/queued" },
    body: "{}",
    signal: ac.signal,
  });

  // Abort before any in-flight completes.
  ac.abort(new Error("queued-abort"));
  await assert.rejects(queued, (err) => err.message === "queued-abort");

  // No second stream should have reached the mock — only the first
  // (in-flight) request's path. After release, only one request total in
  // mock.requests.
  mock.releaseOne();
  await inFlight;
  assert.equal(mock.requests.length, 1, "aborted queued request must not dispatch a stream");
  assert.equal(mock.requests[0].path, "/3/device/in-flight");
});

test("queue is strict FIFO across multiple waiters", async (t) => {
  const mock = await startReleasableMock({ maxConcurrentStreams: 1 });
  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 60_000,
    // Pin the user cap to 1 so the test is independent of when the peer's
    // SETTINGS frame arrives (peer also says 1, but the SDK acts on the
    // tighter of user / peer / floor regardless of timing).
    maxConcurrentStreams: 1,
    connect: connectInsecure,
  });
  t.after(async () => {
    mock.releaseAll();
    await client.close();
    await mock.close();
  });

  const order = [];
  const requests = [];
  for (let i = 0; i < 4; i++) {
    const p = client
      .request({
        headers: { ":method": "POST", ":path": `/3/device/${i}` },
        body: "{}",
      })
      .then(() => order.push(i));
    requests.push(p);
  }

  // Release one stream at a time and verify completion order.
  for (let i = 0; i < 4; i++) {
    await mock.awaitArrival();
    mock.releaseOne();
    await new Promise((res) => setTimeout(res, 15));
  }
  await Promise.all(requests);
  assert.deepEqual(order, [0, 1, 2, 3]);
});

test("close() rejects every queued waiter with the closed error", async (t) => {
  const mock = await startReleasableMock({ maxConcurrentStreams: 1 });
  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 60_000,
    connect: connectInsecure,
  });
  t.after(async () => {
    mock.releaseAll();
    await mock.close();
  });

  // Fill the cap, then enqueue three waiters.
  const inFlight = client.request({
    headers: { ":method": "POST", ":path": "/3/device/in-flight" },
    body: "{}",
  });
  await mock.awaitArrival();

  const queued = [];
  for (let i = 0; i < 3; i++) {
    queued.push(
      client.request({
        headers: { ":method": "POST", ":path": `/3/device/queued-${i}` },
        body: "{}",
      }),
    );
  }

  const closePromise = client.close();
  for (const p of queued) {
    await assert.rejects(p, (err) => /Http2Client is closed/.test(err.message));
  }
  mock.releaseOne();
  // The in-flight request was dispatched before close; it should still
  // resolve cleanly against the mock.
  await inFlight;
  await closePromise;
});

test("aborted queued request detaches its abort listener (MaxListeners hygiene)", async (t) => {
  const mock = await startReleasableMock({ maxConcurrentStreams: 1 });
  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 60_000,
    connect: connectInsecure,
  });
  t.after(async () => {
    mock.releaseAll();
    await client.close();
    await mock.close();
  });

  const inFlight = client.request({
    headers: { ":method": "POST", ":path": "/3/device/in-flight" },
    body: "{}",
  });
  await mock.awaitArrival();

  // Counting shim: only the abort listener Http2Client attaches at enqueue
  // is observable here (the stream-level abort listener would attach later,
  // and a queued request that aborts never gets that far).
  const attached = new Set();
  const signal = {
    aborted: false,
    addEventListener(type, listener) {
      if (type === "abort") attached.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") attached.delete(listener);
    },
    reason: undefined,
  };
  const queued = client.request({
    headers: { ":method": "POST", ":path": "/3/device/queued" },
    body: "{}",
    signal,
  });

  // Simulate abort.
  signal.aborted = true;
  signal.reason = new Error("simulated-abort");
  for (const listener of attached) listener();

  await assert.rejects(queued, (err) => err.message === "simulated-abort");
  assert.equal(
    attached.size,
    0,
    "queued-abort path must remove its abort listener so long-lived signals do not leak",
  );

  mock.releaseOne();
  await inFlight;
});

// JwtCacheLike strategy pattern: the SDK accepts an externally-owned JWT
// cache. The default in-memory cache is a JwtCacheLike implementation; this
// test pins that an async implementation works end-to-end.

test("createPushClient honors an injected async JwtCacheLike", async (t) => {
  // Use a dynamic import on the dist build so the test mirrors how a real
  // consumer would import the SDK.
  const { createPushClient } = await import("../dist/index.js");
  const mock = await startMockApns(() => ({ status: 200, body: "{}" }));

  let getCount = 0;
  const customCache = {
    async get() {
      getCount += 1;
      // Simulate Redis round-trip; the SDK must await.
      await new Promise((res) => setImmediate(res));
      return `header.payload.signature-${getCount}`;
    },
    async invalidate() {
      // No-op for this test; the retry-on-expired path is exercised in
      // client.test.mjs against the default cache.
    },
  };

  const client = createPushClient({
    bundleId: "com.example.test",
    environment: "development",
    jwtCache: customCache,
    [Symbol.for("@mobile-surfaces/push/test-transport-override")]: {
      sendOrigin: mock.origin,
      manageOrigin: mock.origin,
      connect: connectInsecure,
    },
  });

  t.after(async () => {
    await client.close();
    await mock.close();
  });

  // Use describeSend / sendNotification path that hits the wire. Driving
  // through the public surface is the strict test; here we exercise that
  // the SDK awaits the cache by issuing a notification send and asserting
  // the cache was queried.
  const snapshot = {
    schemaVersion: "5",
    kind: "notification",
    id: "test-snap",
    surfaceId: "surface-test",
    updatedAt: new Date().toISOString(),
    state: "attention",
    notification: {
      title: "test",
      body: "body",
      deepLink: "mobilesurfaces://surface/test",
      category: "surface-update",
    },
  };
  await client.sendNotification("a".repeat(64), snapshot);

  assert.ok(getCount >= 1, "injected jwtCache.get() must be awaited per send");
  // The request should carry the bearer the cache returned.
  const sent = mock.requests[0];
  assert.match(String(sent.headers.authorization), /^bearer header\.payload\.signature-/);
});
