// Client-side pre-flight checks the PushClient applies before any APNs
// round-trip. Extracted from client.ts so the checks are independently
// testable and so the bloated client.ts shrinks toward its eventual
// post-split shape (RequestPipeline + operations/*.ts).
//
// Every function here is pure — no state, no network, no JWT. They throw
// typed errors (PayloadTooLargeError, BadDateError, BadExpirationDateError)
// with `status: 400`/`413` so observability hooks bucket client-caught and
// server-returned variants together.
//
// MS011: payload size ceilings.
// MS032: timestamp magnitude / sign rules.

import {
  BadDateError,
  BadExpirationDateError,
  PayloadTooLargeError,
} from "./errors.ts";

// APNs payload ceilings per MS011. Per-activity and alert sends are bounded
// at 4 KB; iOS 18 broadcast pushes get an extra 1 KB. The SDK enforces
// these client-side so callers see PayloadTooLargeError before the round-
// trip.
export const MAX_PAYLOAD_BYTES_DEFAULT = 4096;
export const MAX_PAYLOAD_BYTES_BROADCAST = 5120;

export type PayloadKind = "alert" | "update" | "start" | "end" | "broadcast";

export function assertPayloadWithinLimit(
  payload: string,
  kind: PayloadKind,
): void {
  const limit =
    kind === "broadcast" ? MAX_PAYLOAD_BYTES_BROADCAST : MAX_PAYLOAD_BYTES_DEFAULT;
  const size = Buffer.byteLength(payload, "utf8");
  if (size > limit) {
    throw new PayloadTooLargeError({
      status: 413,
      message: `Client-side pre-flight: payload size ${size} bytes exceeds limit ${limit} for ${kind}; rejected before APNs round-trip. See MS011.`,
    });
  }
}

/**
 * Lower bound below which a value is treated as a millisecond-magnitude
 * timestamp rather than unix seconds. Unix-seconds values for any realistic
 * date stay well under 1e11 (year 2286 is ~9.9e9 seconds); a millisecond
 * timestamp for any date past 1973 is already above it. Date.now() returns
 * ~1.7e12, the single most common MS032 offender, so any field at or above
 * this boundary is rejected as a millisecond value passed where seconds
 * were expected.
 */
export const MILLISECOND_MAGNITUDE_FLOOR = 1e11;

/**
 * Client-side pre-flight for MS032: every Live Activity timestamp field
 * (`staleDateSeconds`, `dismissalDateSeconds`, and the `expirationSeconds`
 * that derives `apns-expiration`) must be a positive unix-seconds integer.
 * APNs rejects non-integer, negative, zero, NaN, and millisecond-magnitude
 * values with 400 BadDate / 400 BadExpirationDate; we surface that before
 * the round-trip the same way `assertPayloadWithinLimit` handles MS011 —
 * reusing the typed error class with `status: 400` so observability hooks
 * bucket the client-caught and server-returned variants together.
 *
 * `undefined` passes through untouched: the field is optional and the
 * caller (or a downstream default) supplies it later. `errorClass` selects
 * BadDate for stale/dismissal fields and BadExpirationDate for the
 * expiration field, matching the reason APNs returns for each; both
 * classes carry trapId "MS032" through the generated trap-bindings table.
 */
export function assertValidActivityTimestamp(
  value: number | undefined,
  field: "staleDateSeconds" | "dismissalDateSeconds" | "expirationSeconds",
  errorClass: typeof BadDateError | typeof BadExpirationDateError,
): void {
  if (value === undefined) return;
  let problem: string | undefined;
  if (!Number.isFinite(value)) {
    problem = "must be a finite number";
  } else if (!Number.isInteger(value)) {
    problem = "must be an integer (no fractional seconds)";
  } else if (value <= 0) {
    problem = "must be a positive unix-seconds value (got zero or negative)";
  } else if (value >= MILLISECOND_MAGNITUDE_FLOOR) {
    problem =
      "looks like a millisecond timestamp; pass unix seconds " +
      "(divide a Date.now() value by 1000)";
  }
  if (problem === undefined) return;
  throw new errorClass({
    status: 400,
    message:
      `Client-side pre-flight: ${field} ${problem} (received ${JSON.stringify(value)}); ` +
      `rejected before APNs round-trip. See MS032.`,
  });
}

/**
 * MS032 pre-flight for the timestamp options shared by device sends and
 * broadcasts. `staleDateSeconds` and `dismissalDateSeconds` are absolute
 * unix-seconds dates with no special-case values. `expirationSeconds` is
 * different: 0 is a documented, valid `apns-expiration` value ("attempt
 * delivery once, do not store") and is policy-required for a no-storage
 * broadcast channel, so a zero passes through untouched here; only a
 * defined, nonzero value is checked for malformed magnitude. #sendDevice,
 * broadcast(), and describeSend() all route through this so the three
 * paths cannot drift.
 */
export function assertActivityTimestampOptions(options: {
  staleDateSeconds?: number;
  dismissalDateSeconds?: number;
  expirationSeconds?: number;
}): void {
  assertValidActivityTimestamp(
    options.staleDateSeconds,
    "staleDateSeconds",
    BadDateError,
  );
  assertValidActivityTimestamp(
    options.dismissalDateSeconds,
    "dismissalDateSeconds",
    BadDateError,
  );
  if (
    options.expirationSeconds !== undefined &&
    options.expirationSeconds !== 0
  ) {
    assertValidActivityTimestamp(
      options.expirationSeconds,
      "expirationSeconds",
      BadExpirationDateError,
    );
  }
}

export const BROADCAST_DEFAULT_TTL_SECONDS = 3600;

/**
 * Resolve `apns-expiration` for a broadcast send. The two channel storage
 * policies have opposite semantics — no-storage requires 0, most-recent-
 * message requires nonzero — and Apple rejects the wrong combination with
 * 400 BadExpirationDate (MS032). We surface that as a client-side pre-
 * flight the same way `assertPayloadWithinLimit` handles MS011: reuse the
 * typed error class with `status: 400` so observability hooks bucket the
 * client-caught and server-returned variants together.
 *
 * The matrix:
 *
 *   storagePolicy           expirationSeconds   resolved expiration
 *   --------------------   ------------------   --------------------
 *   "no-storage" (default)  unset or 0           0
 *   "no-storage"            nonzero              throw (no-storage cannot defer)
 *   "most-recent-message"   unset                now + 3600
 *   "most-recent-message"   0                    throw (defeats the policy)
 *   "most-recent-message"   nonzero              expirationSeconds
 */
export function resolveBroadcastExpiration(options: {
  storagePolicy?: "no-storage" | "most-recent-message";
  expirationSeconds?: number;
}): number {
  const policy = options.storagePolicy ?? "no-storage";
  const requested = options.expirationSeconds;
  if (policy === "no-storage") {
    if (requested !== undefined && requested !== 0) {
      throw new BadExpirationDateError({
        status: 400,
        message:
          `Client-side pre-flight: broadcast() with storagePolicy "no-storage" must send apns-expiration: 0 ` +
          `(received expirationSeconds: ${requested}). No-storage channels cannot defer delivery; ` +
          `if you need a TTL, create the channel with storagePolicy: "most-recent-message". See MS032.`,
      });
    }
    return 0;
  }
  if (requested === 0) {
    throw new BadExpirationDateError({
      status: 400,
      message:
        `Client-side pre-flight: broadcast() with storagePolicy "most-recent-message" requires a nonzero apns-expiration ` +
        `(received 0). A TTL of 0 defeats the channel's storage policy; pass expirationSeconds as a unix-seconds value ` +
        `or omit it to default to now + ${BROADCAST_DEFAULT_TTL_SECONDS}s. See MS032.`,
    });
  }
  return requested ?? Math.floor(Date.now() / 1000) + BROADCAST_DEFAULT_TTL_SECONDS;
}
