// Pure parsing for the values surfaceStorage reads back out of the App
// Group. Kept in its own module with no native imports (no
// @bacons/apple-targets) so the decode logic is unit-testable on its own;
// surfaceStorage/index.ts pairs these with the ExtensionStorage reads.

// Decode-error breadcrumbs are written from the Swift side when JSONDecoder
// fails to parse the snapshot payload (MS036's silent-fail mode). Shape on
// the wire:
//   `{ at: <ISO8601>, error: <string>, trapId?: <string> }`
// `trapId` was added in v7: the Swift writer defaults to "MS036" (the trap
// the breadcrumb represents) and MSTrapBound errors override with their own
// binding. Older builds (pre-v7) omit the field; readers tolerate either
// shape and fall back to MS036.
export interface SurfaceDecodeErrorBreadcrumb {
  readonly surfaceId: string;
  readonly at: string;
  readonly error: string;
  readonly trapId: string;
}

/**
 * Parse a decode-error breadcrumb value read from the App Group. Returns
 * null when the value is absent (the common case — every successful decode
 * clears the key from the Swift side) or present but malformed.
 *
 * Malformed values intentionally return null rather than throwing: a stale
 * breadcrumb from an older app version is not actionable, and the harness
 * diagnostics row is a "warn" hint, not a hard failure.
 *
 * Swift writes the breadcrumb as a JSON-encoded string in our pipeline;
 * a raw object is tolerated too in case a future writer drops the JSON layer.
 */
export function parseDecodeErrorBreadcrumb(
  surfaceId: string,
  raw: unknown,
): SurfaceDecodeErrorBreadcrumb | null {
  if (raw == null) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { at?: unknown; error?: unknown; trapId?: unknown };
  if (typeof obj.at !== "string" || typeof obj.error !== "string") return null;
  // trapId is optional on the wire (pre-v7 writers omitted it). Default to
  // MS036, the trap this breadcrumb represents at the host-side write
  // boundary.
  const trapId = typeof obj.trapId === "string" ? obj.trapId : "MS036";
  return { surfaceId, at: obj.at, error: obj.error, trapId };
}

/**
 * Coerce a raw snapshot value read from the App Group into the shape the
 * payload inspector renders. Swift writes the snapshot as a JSON string;
 * a JSON string is decoded, a non-string value is passed through, and a
 * string that does not parse is kept verbatim so the inspector can still
 * display the exact bytes. An absent value coerces to null.
 */
export function coerceSnapshotValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Coerce a raw writtenAt value (Unix seconds) read from the App Group.
 * Accepts a finite number directly, parses a numeric string via Number(),
 * and returns null for anything else (absent, NaN, non-numeric). Note that
 * Number() treats an empty or whitespace-only string as 0; that edge is
 * carried over verbatim from the pre-extraction inline logic rather than
 * silently changed here.
 */
export function coerceWrittenAt(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
