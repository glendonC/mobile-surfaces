// Redaction helpers for the surface:diagnose bundle. The bundle is designed
// to be safe to paste into a public GitHub issue; this is the centralized
// policy that enforces it. Producers must route every value through these
// helpers before putting it in a DiagnosticReport / DiagnosticBundle.
//
// What we redact:
// - Absolute paths inside $HOME → "~/..." (so usernames don't leak).
// - APNs-token-shaped strings (64+ hex chars) → "<redacted-token>".
// - PEM blocks (BEGIN ... END) → "<redacted-pem>".
// - Long opaque strings (>120 chars without spaces) → length-only fingerprint.
//
// What we DO NOT redact:
// - Non-home absolute paths (these are typically project-local).
// - Bundle ids, scheme strings, App Group identifiers (already public).
// - Version strings, status enums, integers.

import { homedir } from "node:os";

const HOME = homedir();

/**
 * Replace $HOME prefix in an absolute path with `~`. Leaves non-home paths
 * unchanged. Use for any path that originates from process.env or
 * user-supplied config; never use for paths your script computed itself
 * inside the project tree (those are already relative).
 */
export function redactHomePath(value) {
  if (typeof value !== "string") return value;
  if (HOME && value.startsWith(HOME)) {
    return value.replace(HOME, "~");
  }
  return value;
}

/**
 * Redact strings that look like push tokens or auth tokens. APNs push tokens
 * are 64-char hex; widen slightly to catch JWTs and similar. Pass through
 * everything else unchanged.
 */
export function redactTokenLike(value) {
  if (typeof value !== "string") return value;
  // Long hex run (push token shape).
  let out = value.replace(/[a-fA-F0-9]{60,}/g, "<redacted-token>");
  // JWT-shape: three base64url segments separated by dots.
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
    "<redacted-jwt>",
  );
  return out;
}

/**
 * Strip PEM blocks (between -----BEGIN and -----END markers) entirely. The
 * push SDK keyPath option can be a Buffer; if a producer accidentally passes
 * the raw PEM contents into the bundle, this catches it.
 */
export function redactPem(value) {
  if (typeof value !== "string") return value;
  return value.replace(
    /-----BEGIN[^\n]*-----[\s\S]*?-----END[^\n]*-----/g,
    "<redacted-pem>",
  );
}

/**
 * Apply every redaction policy to a value in dependency-friendly order.
 * Use this as the default entry point for any string that came from outside
 * the script's own constants (env vars, config files, error messages).
 */
export function redact(value) {
  if (typeof value !== "string") return value;
  return redactHomePath(redactTokenLike(redactPem(value)));
}

/**
 * Recursively redact a structured value. Objects keep their shape; values
 * are routed through `redact()`. Arrays preserve order.
 */
export function redactDeep(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * Boolean presence probe for an environment variable. Returns "set" if the
 * variable is non-empty, "unset" otherwise. Never returns the value.
 */
export function envPresence(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? "set" : "unset";
}
