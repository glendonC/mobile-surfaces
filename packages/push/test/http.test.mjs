import { test } from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";

const { Http2Client } = await import("../dist/http.js");

import { startMockApns } from "./fixtures/mock-apns.mjs";

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
