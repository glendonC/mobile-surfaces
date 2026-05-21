// GENERATED - DO NOT EDIT. Source: data/apns-reasons.json.
// Regenerate: pnpm surface:codegen
//
// APNs reason -> cause/fix table. Reason strings are taken verbatim from
// Apple's APNs documentation; the channel reasons come from the iOS 18
// broadcast and channel-management APIs. errors.ts maps each reason to a
// typed ApnsError subclass via reasonToError; scripts/check-apns-reason-
// coverage.mjs gates that mapping against data/apns-reasons.json.

export interface ApnsReasonGuideEntry {
  cause: string;
  fix: string;
}

export const APNS_REASON_GUIDE: Record<string, ApnsReasonGuideEntry> = {
  BadCertificate: {
    cause: "The certificate offered during the TLS handshake was invalid.",
    fix: "Mobile Surfaces authenticates with a provider JWT, not a client certificate. Seeing this means a proxy or TLS-intercepting layer is rewriting the connection. Confirm the client reaches api.push.apple.com (or the sandbox host) directly.",
  },
  BadCertificateEnvironment: {
    cause: "The client certificate offered was for the wrong APNs environment.",
    fix: "Same root cause as BadCertificate: Mobile Surfaces uses token authentication, so an environment-mismatched certificate can only come from an intercepting proxy. Remove the proxy or point it at the correct host.",
  },
  BadChannelId: {
    cause: "The apns-channel-id header isn't properly encoded, or it's greater than the allowed length.",
    fix: "Channel IDs are base64-encoded strings returned by createChannel(). Don't truncate, URL-decode, or re-encode them; pass the value through as-is.",
  },
  BadCollapseId: {
    cause: "The apns-collapse-id header exceeds the 64-byte limit.",
    fix: "Collapse ids must be 64 bytes or fewer. Shorten the value passed as collapseId before sending.",
  },
  BadDate: {
    cause: "A timestamp field is malformed.",
    fix: "Same as BadExpirationDate — confirm staleDateSeconds / dismissalDateSeconds are unix-seconds integers.",
  },
  BadDeviceToken: {
    cause: "Token / environment mismatch.",
    fix: "Use environment 'development' for dev-client / expo run:ios builds, 'production' only for TestFlight / App Store builds. Tokens from one environment do not authenticate against the other.",
  },
  BadExpirationDate: {
    cause: "expirationSeconds or apns-expiration is malformed.",
    fix: "Pass a positive unix-seconds integer. For broadcast on a No-Message-Stored channel, apns-expiration must be 0 — Apple rejects nonzero expirations there.",
  },
  BadMessageId: {
    cause: "The apns-id header value is malformed.",
    fix: "Omit apns-id and let APNs assign one, or pass a valid UUID string.",
  },
  BadPath: {
    cause: "The request URL path was malformed.",
    fix: "This indicates an SDK bug — the client builds the APNs request path internally. File an issue with the apns-id from the response.",
  },
  BadPriority: {
    cause: "Priority is not 5 or 10.",
    fix: "Use priority 5 (default for Live Activity) or 10 (immediate user-visible).",
  },
  BadTopic: {
    cause: "The apns-topic header is malformed.",
    fix: "Set bundleId to the bare bundle identifier. The SDK derives apns-topic from it; do not pass a pre-formatted topic header.",
  },
  CannotCreateChannelConfig: {
    cause: "You have reached the maximum channel limit for your application.",
    fix: "Apple allows up to 10,000 channels per app per environment. Use listChannels() to audit, then deleteChannel() on stale channels before creating new ones.",
  },
  ChannelNotRegistered: {
    cause: "The apns-channel-id header used in the request doesn't exist.",
    fix: "Channels are environment-scoped — a channel created in 'development' cannot be reached in 'production', and vice versa. Re-create the channel in the target environment, or call listChannels() to confirm it exists.",
  },
  DeviceTokenNotForTopic: {
    cause: "The device token does not match the specified topic.",
    fix: "Confirm the token was minted by a build whose bundle identifier matches bundleId. A token issued to a different app cannot receive this topic.",
  },
  DuplicateHeaders: {
    cause: "One or more request headers were sent more than once.",
    fix: "This indicates a transport-layer bug — the SDK builds each APNs header exactly once. File an issue with the apns-id from the response.",
  },
  ExpiredProviderToken: {
    cause: "JWT is older than 1 hour and APNs rejected it.",
    fix: "The SDK refreshes JWTs every 50 minutes; this usually means system clock skew. Sync NTP and retry.",
  },
  FeatureNotEnabled: {
    cause: "Broadcast capability is not enabled for this bundle id.",
    fix: "Enable broadcast for the auth key in the Apple Developer portal (Certificates, Identifiers & Profiles > Keys). The capability is per-key, not per-app.",
  },
  Forbidden: {
    cause: "Auth key was revoked.",
    fix: "Generate a new APNs auth key in the Apple Developer portal and update keyPath / keyId.",
  },
  IdleTimeout: {
    cause: "The connection was idle too long and APNs closed it.",
    fix: "Retry the send. The SDK re-dials a fresh HTTP/2 session automatically; an isolated occurrence is safe to ignore. Sustained occurrences point at a network path that drops idle connections.",
  },
  InternalServerError: {
    cause: "An internal server error occurred at APNs.",
    fix: "Retry with exponential backoff. The default retry policy already handles this.",
  },
  InvalidProviderToken: {
    cause: "JWT was rejected by APNs.",
    fix: "Confirm keyId (10 chars), teamId (10 chars), and the .p8 at keyPath all match the same auth key in the Apple Developer portal. JWTs are also rejected when local clock skew exceeds ~1 hour — sync system time.",
  },
  InvalidPushType: {
    cause: "The apns-push-type attribute is set to an incorrect value. The only allowed value is LiveActivity (for channels).",
    fix: "For broadcast/channel sends the SDK always sets apns-push-type=liveactivity. If you reach this from a custom payload, drop the override.",
  },
  MethodNotAllowed: {
    cause: "The request used an HTTP method other than POST.",
    fix: "This indicates an SDK bug — APNs requires POST and the SDK always uses it. File an issue with the apns-id from the response.",
  },
  MissingChannelId: {
    cause: "The apns-channel-id header is missing.",
    fix: "Pass channelId to broadcast() and deleteChannel(). The header is set automatically when the argument is provided.",
  },
  MissingDeviceToken: {
    cause: "The request carried no device token.",
    fix: "Pass a non-empty device token to the send method. An empty string reaches APNs as a missing token.",
  },
  MissingProviderToken: {
    cause: "No provider token (JWT) was supplied and no client certificate was used.",
    fix: "This indicates a JWT-signing failure. Confirm keyId, teamId, and keyPath are set so the SDK can mint a bearer token before the send.",
  },
  MissingPushType: {
    cause: "The apns-push-type header is missing.",
    fix: "The SDK sets this automatically; if you see this from a custom payload, restore the default behavior.",
  },
  MissingTopic: {
    cause: "apns-topic header missing or wrong format.",
    fix: "Set bundleId to your bundle identifier (without .push-type.liveactivity suffix; the SDK appends it).",
  },
  PayloadEmpty: {
    cause: "The request body was empty.",
    fix: "This indicates a projection bug — confirm the snapshot projects to a non-empty payload before the send.",
  },
  PayloadTooLarge: {
    cause: "ActivityKit payload exceeded 4 KB (5 KB for broadcast).",
    fix: "Trim the snapshot fields. Per-activity payloads are bounded at 4 KB; broadcast payloads at 5 KB.",
  },
  ServiceUnavailable: {
    cause: "The APNs service is temporarily unavailable.",
    fix: "Retry with exponential backoff. The default retry policy already handles this.",
  },
  TooManyProviderTokenUpdates: {
    cause: "The provider token (JWT) is being refreshed too frequently.",
    fix: "Reuse one PushClient across sends. The SDK caches the JWT and refreshes it every 50 minutes; constructing a fresh client per send re-mints the token on every call and trips this limit.",
  },
  TooManyRequests: {
    cause: "Apple is rate-limiting your bundle id (or the Live Activity priority budget is exhausted).",
    fix: "Back off. Live Activity priority 10 has aggressive budgets — drop to 5 unless the update is user-visible.",
  },
  TopicDisallowed: {
    cause: "Auth key is not enabled for this bundle id, or bundleId does not match the iOS app bundle identifier.",
    fix: "For Live Activity pushes, the topic is automatically suffixed with .push-type.liveactivity. Do not include that suffix in bundleId itself.",
  },
  Unregistered: {
    cause: "The token's Live Activity ended, the user uninstalled the app, or the OS rotated the token.",
    fix: "Discard the token and stop selecting it for sends. Per MS020, treat the latest pushTokenUpdates / pushToStartTokenUpdates emission as authoritative.",
  },
};

/**
 * Reasons that the default retry policy should treat as retryable. Connection
 * errors (ECONNRESET, etc.) are handled separately at the transport layer via
 * RETRYABLE_TRANSPORT_CODES in transport.ts.
 *
 * ExpiredProviderToken is included because the SDK invalidates the JwtCache
 * on that reason before the retry attempt, so the next request carries a
 * freshly-minted token. Without that JWT invalidation the retry would loop
 * sending the same expired bearer; with it, a single retry recovers from a
 * mid-flight expiry / clock-skew rejection (MS030) without surfacing to the
 * caller. The TERMINAL_REASONS guard still denies retries for permanently-
 * broken tokens, so this widening cannot mask BadDeviceToken / Unregistered.
 *
 * Membership is derived from `retryable: true` in data/apns-reasons.json.
 */
export const DEFAULT_RETRYABLE_REASONS: ReadonlySet<string> = new Set([
  "ExpiredProviderToken",
  "IdleTimeout",
  "InternalServerError",
  "ServiceUnavailable",
  "TooManyRequests",
]);

/**
 * Reasons that will never recover on retry and must never be retried, even if
 * a caller-supplied `retryableReasons` set happens to include one of them by
 * mistake. The PushClient denies these before consulting `retryableReasons`,
 * so retry-policy widening cannot accidentally burn budget on tokens that
 * iOS has permanently rejected.
 *
 * Membership is intentionally narrow and is derived from `terminal: true` in
 * data/apns-reasons.json: only reasons guaranteed to stay broken on the next
 * attempt (bad-device-token, payload-too-large, topic-disallowed, unregistered
 * token). Provider-token reasons such as ExpiredProviderToken are NOT terminal
 * because the SDK refreshes the JWT on the next attempt; auth-key revocation
 * (Forbidden) is also excluded so the default policy can surface it via the
 * existing reason-not-in-retryable fallthrough rather than appearing to be a
 * configurable knob.
 */
export const TERMINAL_REASONS: ReadonlySet<string> = new Set([
  "BadDeviceToken",
  "PayloadTooLarge",
  "TopicDisallowed",
  "Unregistered",
]);
