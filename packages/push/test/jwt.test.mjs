import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Pull the JWT cache from the built dist so we exercise the same module the
// public surface ships. The test runs after `pnpm build`.
const { JwtCache, mintJwt } = await import("../dist/jwt.js").catch(async () => {
  // Fallback: tsup splits modules, so jwt may be inlined into index. In that
  // case re-export from index isn't part of the public surface — skip the
  // test rather than reach into private internals via path tricks.
  throw new Error(
    "Expected built dist/jwt.js. Did you run `pnpm build` before `pnpm test`?",
  );
});

import { generateEs256Pem } from "./fixtures/setup-cert.mjs";

const KEY_PEM = generateEs256Pem();

function decodeJwt(token) {
  const [headerB64, payloadB64, sigB64] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")),
    sigLen: Buffer.from(sigB64, "base64url").length,
  };
}

test("mintJwt produces a verifiable ES256 JWT with expected claims", () => {
  const token = mintJwt(
    { keyPem: KEY_PEM, keyId: "ABC1234567", teamId: "TEAM123456" },
    1_700_000_000_000,
  );
  const decoded = decodeJwt(token);
  assert.equal(decoded.header.alg, "ES256");
  assert.equal(decoded.header.typ, "JWT");
  assert.equal(decoded.header.kid, "ABC1234567");
  assert.equal(decoded.payload.iss, "TEAM123456");
  assert.equal(decoded.payload.iat, Math.floor(1_700_000_000_000 / 1000));
  // ES256 raw signature is 64 bytes (r||s, P-256). Hand-rolled signing uses
  // dsaEncoding=ieee-p1363 to guarantee that exact output.
  assert.equal(decoded.sigLen, 64);

  // Verify with the matching public key.
  const [head, payload, sig] = token.split(".");
  const verify = crypto.createVerify("SHA256");
  verify.update(`${head}.${payload}`);
  const pubKey = crypto.createPublicKey(KEY_PEM);
  const ok = verify.verify(
    { key: pubKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(sig, "base64url"),
  );
  assert.equal(ok, true);
});

test("JwtCache mints once and reuses until refresh window passes", () => {
  let now = 1_700_000_000_000;
  const cache = new JwtCache(
    { keyPem: KEY_PEM, keyId: "ABC1234567", teamId: "TEAM123456" },
    { now: () => now, refreshIntervalMs: 50 * 60_000 },
  );
  const a = cache.get();
  const b = cache.get();
  assert.equal(a, b, "second get within window must reuse cached token");

  // Advance just under refresh window: still cached.
  now += 49 * 60_000;
  const c = cache.get();
  assert.equal(c, a);

  // Advance past 50min boundary: new token minted.
  now += 2 * 60_000;
  const d = cache.get();
  assert.notEqual(d, a, "after 50min window the cache must re-mint");
});

// Regression pins for the synchronous-mint invariant documented in jwt.ts.
// The cache MUST mint exactly once across a burst of get() calls landing at
// the same now(), and exactly twice when those calls straddle the refresh
// boundary. If a future change accidentally introduces an await inside the
// mint branch, two concurrent sends near the boundary could both pass the
// freshness check and both mint, wasting an ES256 signature on every burst.
// Counting crypto.createSign invocations is the closest we can get to that
// "did we mint extra?" question without reaching into private fields.
test("JwtCache mints exactly once when many gets land at the same now()", () => {
  const cache = new JwtCache(
    { keyPem: KEY_PEM, keyId: "ABC1234567", teamId: "TEAM123456" },
    { now: () => 1_700_000_000_000, refreshIntervalMs: 50 * 60_000 },
  );

  const originalCreateSign = crypto.createSign;
  let signCount = 0;
  crypto.createSign = (...args) => {
    signCount += 1;
    return originalCreateSign.apply(crypto, args);
  };
  try {
    for (let i = 0; i < 8; i += 1) cache.get();
  } finally {
    crypto.createSign = originalCreateSign;
  }
  assert.equal(signCount, 1, "expected exactly one mint across 8 gets");
});

test("JwtCache mints exactly twice when gets straddle the 50min boundary", () => {
  let now = 1_700_000_000_000;
  const cache = new JwtCache(
    { keyPem: KEY_PEM, keyId: "ABC1234567", teamId: "TEAM123456" },
    { now: () => now, refreshIntervalMs: 50 * 60_000 },
  );

  const originalCreateSign = crypto.createSign;
  let signCount = 0;
  crypto.createSign = (...args) => {
    signCount += 1;
    return originalCreateSign.apply(crypto, args);
  };
  try {
    cache.get();
    cache.get();
    // 1ms past the boundary: the next get() must re-mint.
    now += 50 * 60_000 + 1;
    cache.get();
    cache.get();
  } finally {
    crypto.createSign = originalCreateSign;
  }
  assert.equal(signCount, 2, "expected one mint per side of the boundary");
});

test("JwtCache.get returns a sync string (concurrency invariant)", () => {
  const cache = new JwtCache(
    { keyPem: KEY_PEM, keyId: "ABC1234567", teamId: "TEAM123456" },
  );
  const result = cache.get();
  assert.equal(typeof result, "string");
});
