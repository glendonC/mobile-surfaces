# @mobile-surfaces/push

Node SDK for sending Mobile Surfaces snapshots to Apple Push Notification service (APNs). Drives the `LiveSurfaceSnapshot` projection helpers from
[`@mobile-surfaces/surface-contracts`](../surface-contracts) at the wire layer:

- per-device alert pushes
- ActivityKit Live Activity start / update / end
- iOS 18 broadcast pushes
- channel-management (create / list / delete)

Zero npm runtime dependencies, only the workspace `surface-contracts` package. Uses `node:http2`, `node:crypto`, and `node:fs` directly.

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

Tokens in this example come from different places: `deviceToken` from normal APNs notification registration, `activityToken` from an active Live Activity, and `pushToStartToken` from ActivityKit's push-to-start token stream. See [`docs/push.md`](../../docs/push.md#token-taxonomy) for the full token lifecycle and [`docs/ios-environment.md`](../../docs/ios-environment.md#apns-environment) for matching `environment` to development vs production builds.

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

Override via `retryPolicy`:

```ts
createPushClient({
  // ...
  retryPolicy: {
    maxRetries: 5,
    baseDelayMs: 250,
    maxDelayMs: 10_000,
    jitter: true,
    retryableReasons: new Set(["TooManyRequests"]),
  },
});
```

## Connection lifecycle

A single long-lived HTTP/2 session per (origin) is multiplexed across concurrent requests. The session auto-reconnects on `goaway` or socket close. After `idleTimeoutMs` (default 60s) of no in-flight requests, the session is closed; the next send re-opens it.

`client.close()` flushes in-flight requests, sets the client to closed, and tears down both sessions (send + management). Subsequent calls throw `ClientClosedError`.

## Next steps

- Read [`docs/backend-integration.md`](../../docs/backend-integration.md) for the full domain event to snapshot to APNs flow.
- Read [`docs/push.md`](../../docs/push.md) for retry policy, APNs hosts, token taxonomy, and smoke-script flags.
- Read [`docs/troubleshooting.md`](../../docs/troubleshooting.md) when APNs returns 200 but nothing appears on the Lock Screen.
