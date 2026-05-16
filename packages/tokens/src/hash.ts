// Portable sha256 hash. The token store builds an idempotency key from
// (kind, activityId, token); the key is not a secret (it just needs to
// be stable across re-emissions of the same triple and distinct across
// real rotations) but using a real cryptographic hash means we do not
// have to think about adversarial inputs.
//
// Three runtimes:
//   1. Node 18+ exposes `node:crypto` with a synchronous createHash.
//   2. React Native (Hermes) and modern browsers expose `crypto.subtle`,
//      which is async.
//   3. Some test environments expose neither; the FNV-1a fallback is
//      correct as a deterministic-key function but not cryptographic.
//
// hashString returns a Promise so the async path is the contract; the
// Node path resolves synchronously via Promise.resolve.

const HEX_TABLE = "0123456789abcdef";

let cachedNodeHash:
  | ((input: string) => string)
  | undefined;
let nodeProbeAttempted = false;

async function loadNodeHash(): Promise<((input: string) => string) | undefined> {
  if (nodeProbeAttempted) return cachedNodeHash;
  nodeProbeAttempted = true;
  try {
    // Dynamic import keeps the bundler from treating node:crypto as a
    // hard dep on the React Native side.
    const mod = await import("node:crypto");
    cachedNodeHash = (input: string) =>
      mod.createHash("sha256").update(input).digest("hex");
  } catch {
    cachedNodeHash = undefined;
  }
  return cachedNodeHash;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out += HEX_TABLE[(b >>> 4) & 0x0f];
    out += HEX_TABLE[b & 0x0f];
  }
  return out;
}

function getWebCrypto(): SubtleCrypto | undefined {
  const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
  return g.crypto?.subtle;
}

// Last-resort deterministic fallback. The package's idempotency-key
// invariant only needs (stable for same input, distinct for rotated
// input); FNV-1a clears that bar even though it isn't cryptographic.
// Hot path stays on sha256 via node:crypto or crypto.subtle.
function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca77);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, "0");
  const b = (h2 >>> 0).toString(16).padStart(8, "0");
  // Mirror the 64-hex-char shape of sha256 so consumers cannot pattern
  // on the prefix and accidentally couple to the strong-hash form.
  return (a + b + a + b + a + b + a + b).slice(0, 64);
}

export async function hashString(input: string): Promise<string> {
  const nodeHash = await loadNodeHash();
  if (nodeHash) return nodeHash(input);
  const subtle = getWebCrypto();
  if (subtle) {
    const data =
      typeof TextEncoder !== "undefined"
        ? new TextEncoder().encode(input)
        : Uint8Array.from(
            Array.from(input, (c) => c.charCodeAt(0) & 0xff),
          );
    const buf = await subtle.digest("SHA-256", data);
    return toHex(new Uint8Array(buf));
  }
  return fnv1aHex(input);
}
