// APNs reason → cause/fix table. Mirrors scripts/send-apns.mjs
// (APNS_REASON_GUIDE) so SDK consumers get the same actionable diagnostics
// without depending on the script. The script is the canonical source for
// human-readable copy; if you edit one, edit the other.
//
// Reason strings are taken verbatim from Apple's "Handling error responses
// from APNs" documentation:
// https://developer.apple.com/documentation/usernotifications/handling-error-responses-from-apns

export interface ApnsReasonGuideEntry {
  cause: string;
  fix: string;
}

export const APNS_REASON_GUIDE: Record<string, ApnsReasonGuideEntry> = {
  BadDeviceToken: {
    cause: "Token / environment mismatch.",
    fix: "Use environment 'development' for dev-client / expo run:ios builds, 'production' only for TestFlight / App Store builds. Tokens from one environment do not authenticate against the other.",
  },
  InvalidProviderToken: {
    cause: "JWT was rejected by APNs.",
    fix: "Confirm keyId (10 chars), teamId (10 chars), and the .p8 at keyPath all match the same auth key in the Apple Developer portal. JWTs are also rejected when local clock skew exceeds ~1 hour — sync system time.",
  },
  TopicDisallowed: {
    cause: "Auth key is not enabled for this bundle id, or bundleId does not match the iOS app bundle identifier.",
    fix: "For Live Activity pushes, the topic is automatically suffixed with .push-type.liveactivity. Do not include that suffix in bundleId itself.",
  },
  Unregistered: {
    cause: "The token's Live Activity ended, the user uninstalled the app, or the OS rotated the token.",
    fix: "Discard the token and stop selecting it for sends. Per MS020, treat the latest pushTokenUpdates / pushToStartTokenUpdates emission as authoritative.",
  },
  Forbidden: {
    cause: "Auth key was revoked.",
    fix: "Generate a new APNs auth key in the Apple Developer portal and update keyPath / keyId.",
  },
  BadPriority: {
    cause: "Priority is not 5 or 10.",
    fix: "Use priority 5 (default for Live Activity) or 10 (immediate user-visible).",
  },
  BadExpirationDate: {
    cause: "expirationSeconds or apns-expiration is malformed.",
    fix: "Pass a positive unix-seconds integer. For broadcast on a No-Message-Stored channel, apns-expiration must be 0 — Apple rejects nonzero expirations there.",
  },
  BadDate: {
    cause: "A timestamp field is malformed.",
    fix: "Same as BadExpirationDate — confirm staleDateSeconds / dismissalDateSeconds are unix-seconds integers.",
  },
  MissingTopic: {
    cause: "apns-topic header missing or wrong format.",
    fix: "Set bundleId to your bundle identifier (without .push-type.liveactivity suffix; the SDK appends it).",
  },
  PayloadTooLarge: {
    cause: "ActivityKit payload exceeded 4 KB (5 KB for broadcast).",
    fix: "Trim the snapshot fields. Per-activity payloads are bounded at 4 KB; broadcast payloads at 5 KB.",
  },
  ExpiredProviderToken: {
    cause: "JWT is older than 1 hour and APNs rejected it.",
    fix: "The SDK refreshes JWTs every 50 minutes; this usually means system clock skew. Sync NTP and retry.",
  },
  TooManyRequests: {
    cause: "Apple is rate-limiting your bundle id (or the Live Activity priority budget is exhausted).",
    fix: "Back off. Live Activity priority 10 has aggressive budgets — drop to 5 unless the update is user-visible.",
  },
  MissingChannelId: {
    cause: "The apns-channel-id header is missing.",
    fix: "Pass channelId to broadcast() and deleteChannel(). The header is set automatically when the argument is provided.",
  },
  BadChannelId: {
    cause: "The apns-channel-id header isn't properly encoded, or it's greater than the allowed length.",
    fix: "Channel IDs are base64-encoded strings returned by createChannel(). Don't truncate, URL-decode, or re-encode them; pass the value through as-is.",
  },
  ChannelNotRegistered: {
    cause: "The apns-channel-id header used in the request doesn't exist.",
    fix: "Channels are environment-scoped — a channel created in 'development' cannot be reached in 'production', and vice versa. Re-create the channel in the target environment, or call listChannels() to confirm it exists.",
  },
  InvalidPushType: {
    cause: "The apns-push-type attribute is set to an incorrect value. The only allowed value is LiveActivity (for channels).",
    fix: "For broadcast/channel sends the SDK always sets apns-push-type=liveactivity. If you reach this from a custom payload, drop the override.",
  },
  CannotCreateChannelConfig: {
    cause: "You have reached the maximum channel limit for your application.",
    fix: "Apple allows up to 10,000 channels per app per environment. Use listChannels() to audit, then deleteChannel() on stale channels before creating new ones.",
  },
  FeatureNotEnabled: {
    cause: "Broadcast capability is not enabled for this bundle id.",
    fix: "Enable broadcast for the auth key in the Apple Developer portal (Certificates, Identifiers & Profiles > Keys). The capability is per-key, not per-app.",
  },
  MissingPushType: {
    cause: "The apns-push-type header is missing.",
    fix: "The SDK sets this automatically; if you see this from a custom payload, restore the default behavior.",
  },
  InternalServerError: {
    cause: "An internal server error occurred at APNs.",
    fix: "Retry with exponential backoff. The default retry policy already handles this.",
  },
  ServiceUnavailable: {
    cause: "The APNs service is temporarily unavailable.",
    fix: "Retry with exponential backoff. The default retry policy already handles this.",
  },
};

/**
 * Reasons that the default retry policy should treat as retryable. Connection
 * errors (ECONNRESET, etc.) are handled separately at the transport layer.
 */
export const DEFAULT_RETRYABLE_REASONS: ReadonlySet<string> = new Set([
  "TooManyRequests",
  "InternalServerError",
  "ServiceUnavailable",
]);

/**
 * Connection-level errors that are always retryable, regardless of reason
 * (since these arrive before APNs can return a JSON body).
 */
export const RETRYABLE_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "NGHTTP2_REFUSED_STREAM",
  // Node's http2 module reports a session that closed unexpectedly
  // (e.g. peer destroyed the connection or sent GOAWAY+close while a
  // stream was in flight) with this code on the failing stream. Treating
  // it as retryable mirrors the connection-error fallthrough we get for
  // ECONNRESET; the next attempt establishes a fresh session.
  "ERR_HTTP2_SESSION_ERROR",
]);
