// ES256 JWT minting for APNs provider authentication. Cached for 50 minutes
// (Apple's hard cap is 60 min; we leave a 10-min safety buffer to avoid
// races with in-flight requests that hold the token by reference).
//
// We use `node:crypto` directly rather than `jose` to keep this package's
// dependency tree at zero (workspace-only). The implementation mirrors
// scripts/send-apns.mjs::makeJwt — same auth key format, same header/payload
// fields, same dsaEncoding ("ieee-p1363", required for ES256 over ECDSA).
// This was a deliberate choice: Round 0 research recommended `jose`, but
// Round 2B already proved hand-rolled ES256 works against APNs in production
// from the script. Replicating that gives the SDK auditability — a reader can
// see exactly what bytes get signed — and avoids pulling in a transitive
// dependency surface for a 30-line primitive.

import crypto from "node:crypto";
import fs from "node:fs";

/**
 * Apple's documented JWT lifetime is 60 minutes. We refresh at 50 minutes so
 * a token never expires mid-flight; the 10-minute buffer also covers small
 * amounts of clock skew between this host and Apple's edge.
 */
export const JWT_REFRESH_INTERVAL_MS = 50 * 60 * 1000;

export interface JwtCacheEntry {
  token: string;
  /** Issued-at, in milliseconds since epoch (Date.now() at mint time). */
  iatMs: number;
}

export interface JwtConfig {
  keyPem: string | Buffer;
  keyId: string;
  teamId: string;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Mint a fresh ES256 JWT. Caller is responsible for caching; use
 * {@link JwtCache} for the cache wrapper.
 */
export function mintJwt(config: JwtConfig, nowMs: number = Date.now()): string {
  const header = base64Url(
    JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }),
  );
  const payload = base64Url(
    JSON.stringify({ iss: config.teamId, iat: Math.floor(nowMs / 1000) }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = crypto
    .createSign("SHA256")
    .update(signingInput)
    .sign({ key: config.keyPem, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64Url(sig)}`;
}

/**
 * Resolve a key path or raw PEM buffer into a string PEM. If the input is a
 * Buffer with PEM markers, return it as-is; otherwise treat as a filesystem
 * path.
 */
export function resolveKeyPem(keyPathOrBuffer: string | Buffer): string {
  if (Buffer.isBuffer(keyPathOrBuffer)) {
    return keyPathOrBuffer.toString("utf8");
  }
  return fs.readFileSync(keyPathOrBuffer, "utf8");
}

/**
 * Lazy JWT cache. Mints on first `get()`, re-mints when the cached token is
 * older than `refreshIntervalMs`. Not thread-safe (Node is single-threaded
 * per worker, so concurrent in-flight requests share the same cached token,
 * which is correct).
 */
export class JwtCache {
  readonly #config: JwtConfig;
  readonly #refreshIntervalMs: number;
  readonly #now: () => number;
  #entry: JwtCacheEntry | undefined;

  constructor(
    config: JwtConfig,
    options: {
      refreshIntervalMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.#config = config;
    this.#refreshIntervalMs = options.refreshIntervalMs ?? JWT_REFRESH_INTERVAL_MS;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * Return a valid JWT, minting or refreshing if needed.
   */
  get(): string {
    const nowMs = this.#now();
    if (
      this.#entry === undefined ||
      nowMs - this.#entry.iatMs > this.#refreshIntervalMs
    ) {
      const token = mintJwt(this.#config, nowMs);
      this.#entry = { token, iatMs: nowMs };
    }
    return this.#entry.token;
  }

  /** Visible for tests: did the cache mint at least once? */
  get cached(): JwtCacheEntry | undefined {
    return this.#entry;
  }

  /** Visible for tests: drop the cache so the next `get()` re-mints. */
  invalidate(): void {
    this.#entry = undefined;
  }
}
