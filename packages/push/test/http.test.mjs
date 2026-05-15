import { test } from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";
import { EventEmitter } from "node:events";

const { Http2Client } = await import("../dist/http.js");

import { startMockApns } from "./fixtures/mock-apns.mjs";

/**
 * Stub of the subset of ClientHttp2Session that Http2Client touches. Used to
 * exercise the close() timeout path without depending on a real h2 peer that
 * may or may not honor a wedged-graceful-close. `closeBehavior` controls
 * whether `session.close()` ever resolves into a "close" event:
 *   - "wedge"   never emit "close" after close() is invoked
 *   - "graceful" emit "close" on next tick (the happy path)
 * `destroy()` always synchronously emits "close" once, matching Node's
 * behavior; the stub also records whether destroy() was called.
 */
function makeFakeSession({ closeBehavior = "wedge" } = {}) {
  const emitter = new EventEmitter();
  const state = {
    closeCalled: false,
    destroyCalled: false,
    closed: false,
    destroyed: false,
  };
  const session = Object.assign(emitter, {
    get closed() {
      return state.closed;
    },
    get destroyed() {
      return state.destroyed;
    },
    close() {
      state.closeCalled = true;
      if (closeBehavior === "graceful") {
        setImmediate(() => {
          state.closed = true;
          emitter.emit("close");
        });
      }
      // wedge: never resolve.
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyCalled = true;
      state.destroyed = true;
      state.closed = true;
      // Real ClientHttp2Session emits "close" synchronously inside destroy();
      // mirror that so the close() listener trips through the same path the
      // production code expects.
      emitter.emit("close");
    },
    // Http2Client never request()s after close, but expose the spies state
    // for assertions.
    __state: state,
  });
  return session;
}

/**
 * Build a connect factory that returns a fake session and emits "connect" on
 * next tick so #ensureSession() resolves. The session is exposed to the test
 * via the returned `sessions` array.
 */
function fakeConnectFactory({ closeBehavior = "wedge" } = {}) {
  const sessions = [];
  const connect = () => {
    const session = makeFakeSession({ closeBehavior });
    sessions.push(session);
    setImmediate(() => session.emit("connect"));
    return session;
  };
  return { connect, sessions };
}

// http.test.mjs covers the transport layer in isolation. The PushClient
// retries ETIMEDOUT (and other RETRYABLE_TRANSPORT_CODES) at a higher level;
// here we just pin the contract that Http2Client surfaces ETIMEDOUT with the
// expected error code so that retry layer can rely on it.

test("Http2Client surfaces per-request timeout as an ETIMEDOUT-coded error", async (t) => {
  // Handler never responds — the stream is opened and held until the SDK
  // times out and cancels it from its side.
  const mock = await startMockApns(() => new Promise(() => {}));

  const connectInsecure = (origin, options) =>
    http2.connect(origin, { ...(options ?? {}) });

  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 1_000,
    connect: connectInsecure,
  });

  t.after(async () => {
    await client.close();
    await mock.close();
  });

  await assert.rejects(
    () =>
      client.request({
        headers: { ":method": "POST", ":path": "/3/device/token" },
        body: "{}",
        timeoutMs: 50,
      }),
    (err) => {
      assert.equal(err.code, "ETIMEDOUT");
      return true;
    },
  );
});

// Regression for the timeout-cleanup leak: the pre-fix code rejected on
// request timeout without removing the AbortSignal's "abort" listener. Long-
// lived signals (an app-wide AbortController, for example) would accumulate
// listeners on every timed-out request and trip Node's
// MaxListenersExceededWarning. The fixed code mirrors the onAbort handler:
// settled-guard, cleanup() to detach the listener, then reject. This test
// pins the listener count to zero after a timeout.

test("Http2Client detaches AbortSignal listener after a request timeout", async (t) => {
  const mock = await startMockApns(() => new Promise(() => {}));
  const connectInsecure = (origin, options) =>
    http2.connect(origin, { ...(options ?? {}) });

  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 1_000,
    connect: connectInsecure,
  });

  t.after(async () => {
    await client.close();
    await mock.close();
  });

  // AbortSignal-shaped object that counts attached "abort" listeners. The
  // Http2Client code path only touches addEventListener("abort", ...) and
  // removeEventListener("abort", ...) plus reads `.aborted`, so a minimal
  // shim is sufficient and lets us assert listener count directly.
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener(type, listener) {
      if (type === "abort") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") listeners.delete(listener);
    },
  };

  await assert.rejects(
    () =>
      client.request({
        headers: { ":method": "POST", ":path": "/3/device/token" },
        body: "{}",
        timeoutMs: 30,
        signal,
      }),
    (err) => {
      assert.equal(err.code, "ETIMEDOUT");
      return true;
    },
  );

  assert.equal(
    listeners.size,
    0,
    "abort listener must be removed after a timeout-induced reject",
  );
});

// close() timeout contract: the previous implementation awaited graceful close
// with no upper bound. A stuck APNs peer could hang process teardown
// indefinitely; the mock-server fixture force-destroys sessions in its own
// close() for exactly this reason. Http2Client now races a graceful close
// against closeTimeoutMs and force-destroys if the bound expires.

test("close() resolves gracefully against a draining peer without forcing destroy", async (t) => {
  // Real mock-server peer: graceful close drains in milliseconds.
  const mock = await startMockApns(() => ({ status: 200, body: "{}" }));
  const connectInsecure = (origin, options) =>
    http2.connect(origin, { ...(options ?? {}) });

  let forcedCalls = 0;
  const client = new Http2Client({
    origin: mock.origin,
    idleTimeoutMs: 60_000,
    closeTimeoutMs: 5_000,
    connect: connectInsecure,
    onForcedDestroy: () => {
      forcedCalls += 1;
    },
  });

  t.after(async () => {
    await mock.close();
  });

  // Make one successful request so a session actually exists before close().
  const res = await client.request({
    headers: { ":method": "POST", ":path": "/3/device/token" },
    body: "{}",
    timeoutMs: 5_000,
  });
  assert.equal(res.status, 200);

  const startedAt = Date.now();
  await client.close();
  const elapsedMs = Date.now() - startedAt;
  // Graceful close against an in-process peer must finish well under the
  // 5s default. Anything over ~1s would suggest the timeout is masking a
  // hang, which is the regression this test is here to catch.
  assert.ok(
    elapsedMs < 1_000,
    `graceful close took ${elapsedMs}ms; expected < 1000ms (default too aggressive or peer wedged)`,
  );
  assert.equal(
    forcedCalls,
    0,
    "onForcedDestroy must not fire when graceful close completes in time",
  );
});

test("close() force-destroys when graceful close exceeds closeTimeoutMs", async () => {
  const { connect, sessions } = fakeConnectFactory({ closeBehavior: "wedge" });
  const forcedInfos = [];
  const client = new Http2Client({
    origin: "http://stub.invalid",
    idleTimeoutMs: 60_000,
    closeTimeoutMs: 50,
    connect,
    onForcedDestroy: (info) => forcedInfos.push(info),
  });

  // Force the client to dial so a session exists for close() to act on. The
  // request itself will never complete (the stub never responds), so abort
  // it on a short timeout — we only care that #ensureSession ran.
  const reqPromise = client
    .request({
      headers: { ":method": "POST", ":path": "/3/device/token" },
      body: "{}",
      timeoutMs: 20,
    })
    .catch(() => {});
  // Yield until the session is recorded.
  while (sessions.length === 0) {
    await new Promise((r) => setImmediate(r));
  }
  await reqPromise;

  const session = sessions[0];
  assert.equal(session.__state.closeCalled, false);
  assert.equal(session.__state.destroyCalled, false);

  const startedAt = Date.now();
  await client.close();
  const elapsedMs = Date.now() - startedAt;

  assert.equal(session.__state.closeCalled, true, "graceful close attempted first");
  assert.equal(session.__state.destroyCalled, true, "force-destroy fired after timeout");
  assert.ok(
    elapsedMs >= 50,
    `close() returned in ${elapsedMs}ms; expected >= closeTimeoutMs (50ms)`,
  );
  assert.equal(forcedInfos.length, 1, "onForcedDestroy fires exactly once");
  assert.ok(
    typeof forcedInfos[0].elapsedMs === "number" && forcedInfos[0].elapsedMs >= 50,
    "onForcedDestroy receives elapsedMs",
  );
});

test("close() is idempotent — repeat and concurrent callers share one outcome", async () => {
  const { connect, sessions } = fakeConnectFactory({ closeBehavior: "wedge" });
  const forcedInfos = [];
  const client = new Http2Client({
    origin: "http://stub.invalid",
    idleTimeoutMs: 60_000,
    closeTimeoutMs: 30,
    connect,
    onForcedDestroy: (info) => forcedInfos.push(info),
  });

  // Dial.
  const reqPromise = client
    .request({
      headers: { ":method": "POST", ":path": "/3/device/token" },
      body: "{}",
      timeoutMs: 20,
    })
    .catch(() => {});
  while (sessions.length === 0) {
    await new Promise((r) => setImmediate(r));
  }
  await reqPromise;

  // Two overlapping close() calls + a third after resolve. All three must
  // observe the same outcome (one forced-destroy event, one session.destroy).
  const [a, b] = await Promise.all([client.close(), client.close()]);
  await client.close();

  assert.equal(a, undefined);
  assert.equal(b, undefined);
  assert.equal(
    sessions[0].__state.destroyCalled,
    true,
    "destroy fired once across concurrent close() calls",
  );
  assert.equal(
    forcedInfos.length,
    1,
    "onForcedDestroy fires exactly once across repeat/concurrent close() calls",
  );
});

test("close() with no live session resolves immediately and does not force-destroy", async () => {
  const { connect } = fakeConnectFactory({ closeBehavior: "graceful" });
  let forcedCalls = 0;
  const client = new Http2Client({
    origin: "http://stub.invalid",
    closeTimeoutMs: 50,
    connect,
    onForcedDestroy: () => {
      forcedCalls += 1;
    },
  });

  const startedAt = Date.now();
  await client.close();
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 50, `no-session close should be effectively instant; took ${elapsedMs}ms`);
  assert.equal(forcedCalls, 0);
});
