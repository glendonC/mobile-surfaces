# @mobile-surfaces/push

Node SDK for sending Mobile Surfaces snapshots to Apple Push Notification service (APNs). Drives the `LiveSurfaceSnapshot` projection helpers from
[`@mobile-surfaces/surface-contracts`](../surface-contracts) at the wire layer:

- per-device alert pushes
- ActivityKit Live Activity start / update / end
- iOS 18 broadcast pushes
- channel-management (create / list / delete)

Wire-layer code only — no HTTP, retry, or APNs client framework. Uses `node:http2`, `node:crypto`, and `node:fs` directly. Runtime deps are the workspace `surface-contracts` package, plus `zod` as a peer (the same instance the contract package uses, so schemas stay interoperable).

## Install

```bash
pnpm add @mobile-surfaces/push @mobile-surfaces/surface-contracts
```

Requires Node 20+ (for stable HTTP/2 + native `crypto.randomUUID`).

## Quickstart

```ts
import { createPushClient } from "@mobile-surfaces/push";
import { surfaceFixtureSnapshots } from "@mobile-surfaces/surface-contracts";

const client = createPushClient({
  keyId: process.env.APNS_KEY_ID!,
  teamId: process.env.APNS_TEAM_ID!,
  keyPath: process.env.APNS_KEY_PATH!,
  bundleId: process.env.APNS_BUNDLE_ID!,
  environment: "development",
});

const snapshot = surfaceFixtureSnapshots.activeProgress;

// Regular alert
await client.alert(deviceToken, snapshot);

// Live Activity content update
await client.update(activityToken, snapshot);

// iOS 17.2+ remote start (push-to-start token)
await client.start(pushToStartToken, snapshot, {
  surfaceId: snapshot.surfaceId,
  modeLabel: snapshot.modeLabel,
});

// End the activity
await client.end(activityToken, snapshot);

// iOS 18 broadcast on a channel
await client.broadcast(channelId, snapshot);

// Channel management
const channel = await client.createChannel({ storagePolicy: "no-storage" });
const channels = await client.listChannels();
await client.deleteChannel(channel.channelId);

await client.close();
```

Tokens in this example come from different places: `deviceToken` from normal APNs notification registration, `activityToken` from an active Live Activity, and `pushToStartToken` from ActivityKit's push-to-start token stream. See [`https://mobile-surfaces.com/docs/push`](https://mobile-surfaces.com/docs/push#token-taxonomy) for the full token lifecycle and [`https://mobile-surfaces.com/docs/ios-environment`](https://mobile-surfaces.com/docs/ios-environment#apns-environment) for matching `environment` to development vs production builds.

## Environment routing

- `development` → `api.development.push.apple.com:443` (sends), `api-manage-broadcast.sandbox.push.apple.com:2195` (channel management).
- `production` → `api.push.apple.com:443` (sends), `api-manage-broadcast.push.apple.com:2196` (channel management).

Note the port split on management traffic: `2195` for sandbox, `2196` for production. Verified against Apple's "Sending channel management requests to APNs" documentation.

## Error taxonomy

All non-2xx responses throw a typed subclass of `ApnsError`:

| Subclass | Reason |
|---|---|
| `BadDeviceTokenError` | Token / environment mismatch. |
| `InvalidProviderTokenError` | JWT rejected (key id, team id, or .p8 wrong). |
| `ExpiredProviderTokenError` | JWT older than 1h (clock skew). |
| `TopicDisallowedError` | Auth key not enabled for this bundle id. |
| `PayloadTooLargeError` | Activity payload > 4 KB (5 KB for broadcast). |
| `BadPriorityError`, `BadExpirationDateError`, `BadDateError` | Header validation. |
| `MissingTopicError`, `MissingChannelIdError`, `BadChannelIdError` | Required header missing or malformed. |
| `ChannelNotRegisteredError` | Channel doesn't exist (env-scoped). |
| `CannotCreateChannelConfigError` | 10,000-channel limit. |
| `InvalidPushTypeError`, `MissingPushTypeError` | apns-push-type wrong. |
| `FeatureNotEnabledError` | Broadcast not enabled on the auth key. |
| `TooManyRequestsError` | 429; `retryAfterSeconds` parsed from `Retry-After`. |
| `UnknownApnsError` | Reason not in the local guide; raw reason on `.reason`. |

All carry `apnsId`, `status`, `timestamp`, and `reason`. `InvalidSnapshotError` is thrown for snapshot validation failures (Zod failure or wrong `kind`); `ClientClosedError` is thrown after `close()`.

## Retry behavior

The default policy retries up to 3 times with exponential backoff (100ms base, 5s cap, jitter on) for:

- `TooManyRequests` (honors `Retry-After`)
- `InternalServerError`
- `ServiceUnavailable`
- transport errors: `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`, `ENETUNREACH`, `EHOSTUNREACH`, `NGHTTP2_REFUSED_STREAM`

Priority 10 sends (the user-visible state transitions) get a tighter retry budget at runtime: `maxRetries` is clamped to 2 and the backoff windows are doubled, so sustained priority-10 retries cannot blow past APNs's budget (see MS015).

Override via `_unsafeRetryOverride`:

```ts
createPushClient({
  // ...
  _unsafeRetryOverride: {
    maxRetries: 5,
    baseDelayMs: 250,
    maxDelayMs: 10_000,
    jitter: true,
    retryableReasons: new Set(["TooManyRequests"]),
  },
});
```

The name is deliberately ugly: the defaults are tuned against MS015 and the priority-aware stretch, and overriding them is usually wrong. The legacy `retryPolicy` option still works in 3.x and logs a one-time deprecation warning per process; it will be removed in 4.0.

`MOBILE_SURFACES_PUSH_DISABLE_RETRY=1` in the environment turns retries off entirely — useful for tests and for diagnosing whether a flake is APNs-side or your retry policy.

## Connection lifecycle

A single long-lived HTTP/2 session per (origin) is multiplexed across concurrent requests. The session auto-reconnects on `goaway` or socket close. After `idleTimeoutMs` (default 60s) of no in-flight requests, the session is closed; the next send re-opens it.

`client.close()` flushes in-flight requests, sets the client to closed, and tears down both sessions (send + management). Subsequent calls throw `ClientClosedError`.

## Next steps

- Read [`https://mobile-surfaces.com/docs/backend-integration`](https://mobile-surfaces.com/docs/backend-integration) for the full domain event to snapshot to APNs flow.
- Read [`https://mobile-surfaces.com/docs/push`](https://mobile-surfaces.com/docs/push) for retry policy, APNs hosts, token taxonomy, and smoke-script flags.
- Read [`https://mobile-surfaces.com/docs/troubleshooting`](https://mobile-surfaces.com/docs/troubleshooting) when APNs returns 200 but nothing appears on the Lock Screen.
