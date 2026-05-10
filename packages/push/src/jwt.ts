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

// Apple .p8 keys are around 250 bytes. 64 KB is generous and prevents a
// misconfigured key path (e.g. pointing at a giant log) from being read into
// memory before we notice.
const KEY_FILE_MAX_BYTES = 64 * 1024;

/**
 * Resolve a key path or raw PEM buffer into a string PEM. If the input is a
 * Buffer with PEM markers, return it as-is; otherwise treat as a filesystem
 * path.
 *
 * On read failure, error messages refer to "the configured APNs key" rather
 * than the resolved absolute path. The path is host-specific (often inside a
 * user home directory) and would otherwise leak into shared logs.
 */
export function resolveKeyPem(keyPathOrBuffer: string | Buffer): string {
  if (Buffer.isBuffer(keyPathOrBuffer)) {
    return keyPathOrBuffer.toString("utf8");
  }
  let fd: number | undefined;
  try {
    fd = fs.openSync(keyPathOrBuffer, "r");
    const stat = fs.fstatSync(fd);
    if (stat.size > KEY_FILE_MAX_BYTES) {
      throw new Error(
        `Configured APNs key is ${stat.size} bytes (max ${KEY_FILE_MAX_BYTES}). Confirm the key path points at a .p8 file.`,
      );
    }
    return fs.readFileSync(fd, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "EACCES" || code === "EISDIR") {
      throw new Error(
        `Could not read configured APNs key (${code}). Confirm the key path points at a readable .p8 file.`,
      );
    }
    throw err;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed; ignore
      }
    }
  }
}

/**
 * Lazy JWT cache. Mints on first `get()`, re-mints when the cached token is
 * older than `refreshIntervalMs`.
 *
 * Concurrency model: safe for any number of concurrent in-flight requests on
 * a single Node event loop, which is the only environment Apple's HTTP/2
 * APNs client targets. Two `get()` calls scheduled in the same tick share the
 * cached entry without re-minting.
 *
 * NOT safe across worker_threads or cluster workers. Each worker keeps its
 * own #entry, so multiple workers may mint independently — that's wasted
 * compute (ES256 signing) but functionally correct, since each JWT is
 * independently valid against APNs. If you require a single mint across
 * workers, sign once in the main thread and pass the token in via your own
 * synchronization (BroadcastChannel, shared cache, etc.).
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
