// Drift guard for the two ES256 APNs JWT minters.
//
// scripts/lib/jwt.mjs::mintApnsJwt and packages/push/src/jwt.ts::mintJwt are
// deliberately separate, byte-equivalent implementations: the script-side lib
// has no build dependency and must not pay the TypeScript-stripping cost, so
// it cannot import the .ts module. Both file headers say "if you change
// either, keep them in sync" — but nothing enforced that until this test.
//
// This test mints a JWT from each implementation with the SAME key and the
// SAME injected clock. ES256 signatures are NOT deterministic — node's ECDSA
// picks a random k per signature, so the signature segment differs between
// any two mints even of identical bytes. The deterministic, drift-catching
// part of a JWT is the signing input: the `header.payload` prefix. This test
// asserts that prefix is byte-identical between the two minters (so a drift
// in header fields, claim names, claim order, or base64url handling in one
// file but not the other fails CI), then separately verifies each
// implementation's signature against the same public key (so a drift in the
// signing algorithm or dsaEncoding is also caught).
//
// Lives in scripts/ so `pnpm test:scripts` (glob scripts/*.test.mjs) picks it
// up automatically. Imports the push minter from the built dist, so it runs
// after `pnpm --filter @mobile-surfaces/push build`.
//
// Run with:
//   node --experimental-strip-types --no-warnings=ExperimentalWarning \
//     --test scripts/lib-jwt-parity.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { mintApnsJwt } from "./lib/jwt.mjs";

const PUSH_DIST_JWT = fileURLToPath(
  new URL("../packages/push/dist/jwt.js", import.meta.url),
);

const { mintJwt } = await import(PUSH_DIST_JWT).catch(() => {
  throw new Error(
    `Expected the built push minter at ${PUSH_DIST_JWT}. ` +
      "Run `pnpm --filter @mobile-surfaces/push build` before this test.",
  );
});

// A throwaway P-256 key pair shared by both minters, mirroring the .p8 APNs
// uses. iat is pinned so the two tokens describe identical bytes.
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const KEY_ID = "ABC1234567";
const TEAM_ID = "TEAM123456";
const FIXED_NOW_MS = 1_700_000_000_000;

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("script and SDK minters produce a byte-identical signing input", () => {
  const signingInput = (token) => token.split(".").slice(0, 2).join(".");
  const fromScript = signingInput(
    mintApnsJwt(
      { keyPem: KEY_PEM, keyId: KEY_ID, teamId: TEAM_ID },
      FIXED_NOW_MS,
    ),
  );
  const fromSdk = signingInput(
    mintJwt({ keyPem: KEY_PEM, keyId: KEY_ID, teamId: TEAM_ID }, FIXED_NOW_MS),
  );
  assert.equal(
    fromScript,
    fromSdk,
    "mintApnsJwt (scripts/lib/jwt.mjs) and mintJwt (packages/push) have drifted; " +
      "their header.payload signing input must be byte-identical. " +
      "Re-sync the two implementations.",
  );
});

test("a JWT minted by either implementation verifies under the other's key path", () => {
  // The signature segment is non-deterministic, but a JWT minted by one
  // implementation must still verify with the same crypto.verify call shape
  // the other side would use. This catches a drift in the signing algorithm
  // or dsaEncoding even though raw signature bytes can never be compared.
  const verifies = (token) => {
    const [header, payload, signature] = token.split(".");
    return crypto.verify(
      "SHA256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
  };
  assert.ok(
    verifies(
      mintApnsJwt(
        { keyPem: KEY_PEM, keyId: KEY_ID, teamId: TEAM_ID },
        FIXED_NOW_MS,
      ),
    ),
    "mintApnsJwt output failed verification",
  );
  assert.ok(
    verifies(
      mintJwt({ keyPem: KEY_PEM, keyId: KEY_ID, teamId: TEAM_ID }, FIXED_NOW_MS),
    ),
    "mintJwt output failed verification",
  );
});

test("both minters emit the same header structure", () => {
  const scriptHeader = decodeSegment(
    mintApnsJwt(
      { keyPem: KEY_PEM, keyId: KEY_ID, teamId: TEAM_ID },
      FIXED_NOW_MS,
    ).split(".")[0],
  );
  const sdkHeader = decodeSegment(
    mintJwt(
      { keyPem: KEY_PEM, keyId: KEY_ID, teamId: TEAM_ID },
      FIXED_NOW_MS,
    ).split(".")[0],
  );
  assert.deepEqual(scriptHeader, sdkHeader);
  assert.deepEqual(scriptHeader, { alg: "ES256", kid: KEY_ID, typ: "JWT" });
});

test("both minters emit the same claim structure", () => {
  const scriptClaims = decodeSegment(
    mintApnsJwt(
      { keyPem: KEY_PEM, keyId: KEY_ID, teamId: TEAM_ID },
      FIXED_NOW_MS,
    ).split(".")[1],
  );
  const sdkClaims = decodeSegment(
    mintJwt(
      { keyPem: KEY_PEM, keyId: KEY_ID, teamId: TEAM_ID },
      FIXED_NOW_MS,
    ).split(".")[1],
  );
  assert.deepEqual(scriptClaims, sdkClaims);
  assert.deepEqual(scriptClaims, {
    iss: TEAM_ID,
    iat: Math.floor(FIXED_NOW_MS / 1000),
  });
});
