// ES256 JWT minting for APNs provider authentication, sharable from .mjs
// scripts. Mirrors packages/push/src/jwt.ts exactly (same algorithm, same
// header fields, same dsaEncoding) but lives in scripts/lib so node scripts
// don't have to spin up TypeScript stripping or import from the published
// package's dist/.
//
// The push package's mintJwt is the canonical version; if you change either,
// keep them in sync. Both implementations are tiny (~15 lines of crypto)
// and audit-friendly — that's the reason for the duplication, see the
// rationale comment at the top of packages/push/src/jwt.ts.

import crypto from "node:crypto";

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Mint a fresh ES256 JWT for APNs provider authentication.
 *
 * @param {object} config
 * @param {string|Buffer} config.keyPem - The .p8 contents (PEM string or buffer).
 * @param {string} config.keyId - The 10-character APNs Key ID (kid claim).
 * @param {string} config.teamId - The 10-character Apple Team ID (iss claim).
 * @param {number} [nowMs] - Override clock for tests; defaults to Date.now().
 * @returns {string} A signed JWT ready for `Authorization: bearer <jwt>`.
 */
export function mintApnsJwt({ keyPem, keyId, teamId }, nowMs = Date.now()) {
  const header = base64Url(
    JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }),
  );
  const payload = base64Url(
    JSON.stringify({ iss: teamId, iat: Math.floor(nowMs / 1000) }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = crypto
    .createSign("SHA256")
    .update(signingInput)
    .sign({ key: keyPem, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64Url(sig)}`;
}
