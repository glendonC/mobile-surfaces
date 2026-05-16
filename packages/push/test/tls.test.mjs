// TLS regression test for the push SDK. Every other client.test.mjs case
// runs over h2c (cleartext HTTP/2) for speed and to avoid juggling certs;
// this file spins up a real h2 server with a freshly-generated self-signed
// cert, points the PushClient at it via `caOverride`, and exercises a JWT
// round-trip end to end.
//
// What this guards against: a regression in Node's default TLS / ALPN
// negotiation (or in how the SDK's Http2Client constructs its session) that
// h2c testing would never catch. Without this file, all 102 client tests
// could continue passing while production TLS quietly broke.

import test from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { generateEs256Pem, writeTempP8 } from "./fixtures/setup-cert.mjs";

const { createPushClient, TEST_TRANSPORT_OVERRIDE } = await import(
  "../dist/index.js"
);
const { surfaceFixtureSnapshots } = await import(
  "@mobile-surfaces/surface-contracts"
);

const SNAPSHOT = surfaceFixtureSnapshots.queued;

function issueLocalhostCert() {
  // Check that openssl is available.
  const check = spawnSync("openssl", ["version"], { encoding: "utf8" });
  if (check.status !== 0) {
    return null;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "ms-push-tls-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  const confPath = path.join(dir, "openssl.cnf");
  writeFileSync(
    confPath,
    [
      "[req]",
      "distinguished_name = req_distinguished_name",
      "x509_extensions = v3_req",
      "prompt = no",
      "[req_distinguished_name]",
      "CN = localhost",
      "[v3_req]",
      "subjectAltName = @alt_names",
      "[alt_names]",
      "DNS.1 = localhost",
      "IP.1 = 127.0.0.1",
    ].join("\n"),
  );
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-nodes",
      "-config",
      confPath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const cert = readFileSync(certPath, "utf8");
  const key = readFileSync(keyPath, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { cert, key };
}

test("push client completes a JWT round-trip over TLS with a self-signed CA override", async (t) => {
  const issued = issueLocalhostCert();
  if (!issued) {
    t.skip("openssl CLI not available; skipping TLS regression test");
    return;
  }
  // Spin up an h2 server with our self-signed cert. The handler accepts
  // anything POSTed at /3/device/<token> and returns 200 + a fixed apns-id
  // so the test can assert the round-trip succeeded.
  const server = http2.createSecureServer({
    cert: issued.cert,
    key: issued.key,
    // Match Apple's ALPN-only h2 expectation.
    allowHTTP1: false,
  });
  const requests = [];
  server.on("stream", (stream, headers) => {
    const path = String(headers[":path"] ?? "");
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      body += chunk;
    });
    stream.on("end", () => {
      requests.push({ path, headers, body });
      stream.respond({ ":status": 200, "apns-id": "tls-round-trip-ok" });
      stream.end();
    });
    stream.on("error", () => {
      // Swallow stream errors; the test asserts via the request log.
    });
  });
  await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", res);
  });
  const port = server.address().port;
  t.after(
    () =>
      new Promise((res) => {
        try {
          server.close(() => res());
        } catch {
          res();
        }
      }),
  );

  // Build a real PushClient with a generated ES256 key for JWT minting and
  // the TLS-only origin override. caOverride trusts the self-signed cert
  // without monkey-patching the global agent.
  const pem = generateEs256Pem();
  const keyFile = writeTempP8(pem);
  t.after(() => keyFile.cleanup());

  const origin = `https://127.0.0.1:${port}`;
  const client = createPushClient({
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    keyPath: keyFile.file,
    bundleId: "com.example.test",
    environment: "development",
    idleTimeoutMs: 500,
    caOverride: issued.cert,
    [TEST_TRANSPORT_OVERRIDE]: {
      sendOrigin: origin,
      // sessionOptions needs servername for SNI on the loopback IP.
      sessionOptions: { servername: "localhost" },
    },
  });
  t.after(() => client.close());

  const res = await client.alert("a".repeat(64), SNAPSHOT);
  assert.equal(res.status, 200);
  // PushClient generates apns-id client-side when not specified, so the
  // server's apns-id response header is informational only - the SDK echoes
  // the request id back to the caller.
  assert.ok(res.apnsId, "round-trip should produce an apns-id");
  assert.equal(requests.length, 1);
  // Authorization header carried a bearer JWT minted from the ES256 key.
  const auth = requests[0].headers.authorization ?? requests[0].headers.Authorization;
  assert.ok(auth, "Authorization header should be present on the TLS round-trip");
  assert.match(String(auth), /^bearer /);
  // Quick sanity-check: JWT shape is three base64url segments separated by dots.
  const token = String(auth).replace(/^bearer /, "");
  assert.equal(token.split(".").length, 3, "JWT should have header.payload.signature shape");
  // Decode the header so a future regression that ships the wrong alg would
  // be visible without parsing the full claim set.
  const header = JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
  );
  assert.equal(header.alg, "ES256");
});
