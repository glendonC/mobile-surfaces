// Tests for scripts/lib/jwt.mjs (mintApnsJwt).
//
// This is the script-side ES256 JWT minter shared by scripts/send-apns.mjs
// and scripts/setup-apns.mjs. It has no build dependency and mirrors the
// @mobile-surfaces/push SDK's mintJwt. These tests cover structure, the
// injectable clock, and that the signature actually verifies against the
// public key — so a future refactor can't silently break APNs auth.
//
// Run with:
//   node --experimental-strip-types --no-warnings=ExperimentalWarning \
//     --test scripts/lib-jwt.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mintApnsJwt } from "./lib/jwt.mjs";

// A throwaway P-256 key pair. ES256 JWTs are signed with the private key and
// verified with the public key; APNs uses the .p8 private key the same way.
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("mintApnsJwt produces a three-segment token", () => {
  const jwt = mintApnsJwt({ keyPem, keyId: "ABC1234567", teamId: "TEAM123456" });
  assert.equal(jwt.split(".").length, 3);
});

test("header carries ES256 / JWT / the key id", () => {
  const jwt = mintApnsJwt({ keyPem, keyId: "ABC1234567", teamId: "TEAM123456" });
  const header = decodeSegment(jwt.split(".")[0]);
  assert.deepEqual(header, { alg: "ES256", kid: "ABC1234567", typ: "JWT" });
});

test("payload carries the team id as iss and iat in unix seconds", () => {
  const nowMs = 1_700_000_000_000;
  const jwt = mintApnsJwt(
    { keyPem, keyId: "ABC1234567", teamId: "TEAM123456" },
    nowMs,
  );
  const payload = decodeSegment(jwt.split(".")[1]);
  assert.equal(payload.iss, "TEAM123456");
  assert.equal(payload.iat, Math.floor(nowMs / 1000));
});

test("iat defaults to the current clock when nowMs is omitted", () => {
  const before = Math.floor(Date.now() / 1000);
  const jwt = mintApnsJwt({ keyPem, keyId: "ABC1234567", teamId: "TEAM123456" });
  const after = Math.floor(Date.now() / 1000);
  const payload = decodeSegment(jwt.split(".")[1]);
  assert.ok(
    payload.iat >= before && payload.iat <= after,
    `iat ${payload.iat} not within [${before}, ${after}]`,
  );
});

test("signature verifies against the public key (ieee-p1363 / ES256)", () => {
  const jwt = mintApnsJwt({ keyPem, keyId: "ABC1234567", teamId: "TEAM123456" });
  const [header, payload, signature] = jwt.split(".");
  const ok = crypto.verify(
    "SHA256",
    Buffer.from(`${header}.${payload}`),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  assert.ok(ok, "JWT signature failed to verify against the public key");
});

test("base64url segments carry no padding or url-unsafe characters", () => {
  const jwt = mintApnsJwt({ keyPem, keyId: "ABC1234567", teamId: "TEAM123456" });
  for (const segment of jwt.split(".")) {
    assert.doesNotMatch(segment, /[+/=]/, "segment is not base64url-clean");
  }
});
