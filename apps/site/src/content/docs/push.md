---
title: "Push"
description: "Wire-layer reference, SDK, smoke script, token taxonomy, error reasons, channel push."
order: 40
group: "Build"
---
# Push

In plain English: this page explains how bytes travel from your backend to Apple's push servers, which token to use for each kind of push, and what to do when APNs rejects or accepts a request.

Deep reference for the wire layer: what `@mobile-surfaces/push` does, what tokens flow through it, where the APNs requests actually go, how to drive the iOS 18 broadcast/channel surface, and what every error reason means. The SDK is the recommended entry point; `scripts/send-apns.mjs` is the protocol-reference script kept self-contained so you can read the exact same wire shape top-to-bottom in a single file. Both target the same APNs endpoints and produce byte-equivalent payloads.

For the high-level "domain event → snapshot → APNs" tour, see [`docs/backend-integration.md`](/docs/backend-integration). For the multi-kind contract and projection helpers, see [`docs/multi-surface.md`](/docs/multi-surface).

## Token taxonomy

ActivityKit and APNs use three distinct token kinds. They are not interchangeable: each has its own source on iOS, its own lifetime, and its own use on the backend.

| Token | Source on iOS | iOS gate | Used for | Lifetime |
| --- | --- | --- | --- | --- |
| Device APNs token | `Notifications` permission grant + standard APNs registration | All supported versions | `client.alert(deviceToken, snapshot)`: plain alerts | Per device + app install. Rotates rarely. |
| Push-to-start token | `Activity<Attributes>.pushToStartTokenUpdates` async sequence | iOS 17.2+ | `client.start(pushToStartToken, snapshot, attributes)`: remote start | Per user / per `ActivityAttributes` type. May be re-issued at any time (cold launch, system rotation). |
| Per-activity push token | `activity.pushTokenUpdates` once iOS issues it after `Activity.request` | iOS 16.2+ (start), 17.2+ (remote start) | `client.update(activityToken, snapshot)`, `client.end(activityToken, snapshot)` | Per activity instance. Discard when the activity ends. |

### Where each token comes from in the harness

- **Device APNs token**: registered by the Expo runtime once notifications are granted. The harness shows it in the bottom row labeled "Device APNs token".
- **Push-to-start token**: the live-activity adapter (`apps/mobile/src/liveActivity/index.ts`) subscribes to `onPushToStartToken` at mount time and logs every value through. The contract for this event is documented in [`docs/architecture.md#adapter-contract`](/docs/architecture#adapter-contract). Apple does not expose a synchronous query, so `getPushToStartToken()` always resolves `null`; production code subscribes to the event stream.
- **Per-activity push token**: emitted on `onPushToken` for each active `Activity` instance. The harness "All active activities" panel renders the token as it streams in.

### How a backend stores them

- Keyed by user / device id. A single user may have multiple devices and therefore multiple device tokens and push-to-start tokens.
- Re-store on every event; both `pushToStartTokenUpdates` and `pushTokenUpdates` may emit fresh values at any time. Treat the latest event as the authoritative value.
- Drop per-activity tokens when `onActivityStateChange` reports `"ended"` / `"dismissed"`. Sending to a finished activity is accepted by APNs and silently dropped by iOS; the backend stops paying for it but iOS will not surface anything.

### FB21158660: push-to-start after force-quit

Apple-reported bug: after a user force-quits the app, `pushToStartTokenUpdates` may stop emitting on subsequent launches until the next OS push delivery wakes the app. Tokens issued before the force-quit remain valid against APNs (the request returns 200), but the OS will not actually start the activity until the user re-launches the app at least once.

There is no client workaround. Document this in customer-support runbooks: "If the Lock Screen activity does not appear after a remote-start push, ask the user to open the app once."

## Environments and endpoints

The SDK and the script route to four distinct hosts depending on environment and operation type:

| Environment | Send host (alerts, Live Activity, broadcast) | Channel-management host |
| --- | --- | --- |
| `development` | `api.development.push.apple.com:443` | `api-manage-broadcast.sandbox.push.apple.com:2195` |
| `production` | `api.push.apple.com:443` | `api-manage-broadcast.push.apple.com:2196` |

Note the **port split** on management traffic: `2195` for sandbox, `2196` for production. This is verified against Apple's "Sending channel management requests to APNs" documentation. It is a different host *and* a different port from the standard send endpoints; the SDK keeps two separate HTTP/2 sessions for this reason.

Every request authenticates with an ES256 JWT signed by your `.p8` auth key. The SDK's `JwtCache` mints tokens once and refreshes them on the 50-minute mark (Apple rejects JWTs older than 1 hour). Local clock skew greater than ~1 hour will surface as `ExpiredProviderToken`; `scripts/send-apns.mjs` prints a warning when the response `Date` header diverges from local time by more than 5 minutes.

## Setup

Two halves: mint the APNs auth key in the Apple Developer portal, then wire its four credentials into a `.env` via the interactive wizard.

### Mint an APNs auth key

1. Sign in to [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles** → **Keys**.
2. Click **+**. Name the key (e.g. `Mobile Surfaces dev`).
3. Tick **Apple Push Notifications service (APNs)**. If you need iOS 18 broadcast channels, also tick **Broadcast Notifications** ([MS034](/docs/traps#ms034-broadcast-capability-must-be-enabled-on-the-apns-auth-key)).
4. Click **Continue** → **Register**.
5. Download the `.p8` file. Apple lets you download once; save outside the repo and lock the permissions:

   ```bash
   mkdir -p ~/.mobile-surfaces
   mv ~/Downloads/AuthKey_*.p8 ~/.mobile-surfaces/
   chmod 600 ~/.mobile-surfaces/AuthKey_*.p8
   ```

6. Copy the 10-character **Key ID** from the key detail page → `APNS_KEY_ID`.
7. Copy your 10-character **Team ID** from the **Membership** tab → `APNS_TEAM_ID`.
8. Your bundle id (the bare `expo.ios.bundleIdentifier` from `apps/mobile/app.json`) goes into `APNS_BUNDLE_ID`. Do NOT append `.push-type.liveactivity` ([MS018](/docs/traps#ms018-apns-bundle-id-must-not-include-the-push-type-liveactivity-suffix)) — the SDK appends it internally.
9. Pick an environment for `APNS_ENVIRONMENT`: `development` for dev-client / TestFlight-development builds, `production` for App Store / TestFlight production. Tokens are environment-scoped ([MS014](/docs/traps#ms014-apns-token-environment-must-match-the-build-environment)).

### Wire the wizard

```bash
pnpm surface:setup-apns
```

Interactive wizard. Prompts for the `.p8` path, key id, team id, bundle id, and environment, then validates the credentials end-to-end against APNs sandbox before writing a `.env` (mode `0600`) at the repo root. The push smoke scripts (`mobile:push:sim`, `mobile:push:device:liveactivity`, `send-apns.mjs`) auto-load that `.env` so you don't have to source it manually. Existing shell exports still win.

Pass `--skip-validate` on offline machines to write the `.env` without the APNs round-trip; pass `--no-write` to dry-run the prompts and see the resolved contents instead.

If you'd rather configure by hand, the four `APNS_*` env vars below the SDK reference are all you need; the wizard is just a guided alternative.

## SDK reference

Install:

```bash
pnpm add @mobile-surfaces/push @mobile-surfaces/surface-contracts
```

Requires Node 20+ (for stable HTTP/2 + native `crypto.randomUUID`).

### `createPushClient`

```ts
import { createPushClient } from "@mobile-surfaces/push";

const client = createPushClient({
  keyId: process.env.APNS_KEY_ID!,        // 10-char Auth Key ID
  teamId: process.env.APNS_TEAM_ID!,      // 10-char Team ID
  keyPath: process.env.APNS_KEY_PATH!,    // path to .p8 OR Buffer of raw PEM
  bundleId: process.env.APNS_BUNDLE_ID!,  // bundle id without .push-type.liveactivity suffix
  environment: "development",             // "development" | "production"
  _unsafeRetryOverride: {                 // operator-grade override; see "Retry policy" below
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    jitter: true,
    retryableReasons: new Set(["TooManyRequests", "InternalServerError", "ServiceUnavailable"]),
  },
  idleTimeoutMs: 60_000,                  // close HTTP/2 session after this many ms idle
});
```

One client per `(auth-key, environment, bundleId)` tuple. A single client multiplexes alert / Live-Activity / broadcast / channel-management traffic over its session pool. `client.close()` flushes in-flight requests and tears down both HTTP/2 sessions; subsequent calls throw `ClientClosedError`.

### `alert(deviceToken, snapshot, options?)`

Plain alert push **from a `liveActivity`-kind snapshot** — the alert-fallback path. Same wire shape as `sendNotification` (push-type `alert`, bare bundle-id topic, priority 10 default) but reads the `liveActivity` slice; payload is built via `toApnsAlertPayload` (also exported for callers who want to construct the payload by hand). Use `sendNotification()` below for the dedicated `notification`-kind snapshot.

```ts
import { surfaceFixtureSnapshots } from "@mobile-surfaces/surface-contracts";

await client.alert(deviceToken, surfaceFixtureSnapshots.attention, {
  priority: 10,                  // default 10 for alerts
  expirationSeconds: 1700003600, // default now + 3600
  collapseId: "order-42",        // optional; APNs dedupes alerts with the same id
});
```

Returns `{ apnsId, status, timestamp, attempts, latencyMs, retried, trapHits }`.

### `sendNotification(deviceToken, snapshot, options?)`

Notification push from a `notification`-kind snapshot. Payload is built via `toNotificationContentPayload` from `@mobile-surfaces/surface-contracts`; carries `aps.alert.title/body`, optional `category` and `thread-id`, plus a `liveSurface` sidecar discriminated as `kind: "surface_notification"`. The OS renders a standard alert; no `UNNotificationContentExtension` is required. A future rich-notification renderer would layer custom UI on top of the same payload.

```ts
import { surfaceFixtureSnapshots } from "@mobile-surfaces/surface-contracts";

await client.sendNotification(deviceToken, surfaceFixtureSnapshots.notificationAlert, {
  collapseId: "thread-3",
});
```

Same push-type / topic / priority defaults as `alert()`; the two methods differ only in input snapshot kind (and therefore payload shape and sidecar discriminator).

### `update(activityToken, snapshot, options?)`

ActivityKit content-state update on an existing activity. Snapshot must be `kind: "liveActivity"`. Sends `apns-push-type: liveactivity`, `apns-priority: 5` by default.

```ts
await client.update(activityToken, surfaceFixtureSnapshots.activeProgress, {
  staleDateSeconds: 1700003600, // optional: ActivityKit stale-date
});
```

### `start(pushToStartToken, snapshot, attributes, options?)`

iOS 17.2+ remote start. Snapshot must be `kind: "liveActivity"`; `attributes` is the static `ActivityAttributes` payload your widget extension's `ActivityConfiguration(for:)` is keyed on. The default `attributesType` is `"MobileSurfacesActivityAttributes"`; override after `pnpm surface:rename`.

```ts
await client.start(
  pushToStartToken,
  surfaceFixtureSnapshots.queued,
  {
    surfaceId: surfaceFixtureSnapshots.queued.surfaceId,
    modeLabel: surfaceFixtureSnapshots.queued.liveActivity.modeLabel,
  },
  { attributesType: "MobileSurfacesActivityAttributes" },
);
```

### `end(activityToken, snapshot, options?)`

End the activity. If `dismissalDateSeconds` is omitted the SDK sets it to now (matching `scripts/send-apns.mjs` behavior). Snapshot must be `kind: "liveActivity"`.

```ts
await client.end(activityToken, surfaceFixtureSnapshots.completed);
```

### `broadcast(channelId, snapshot, options?)`

iOS 18+ broadcast on a channel. Routes to `/4/broadcasts/apps/<bundle-id>` with `apns-channel-id` header; no `apns-topic` is sent. Snapshot must be `kind: "liveActivity"`.

```ts
await client.broadcast("Wj9rT1xkYS0xZGYxLT…==", surfaceFixtureSnapshots.activeProgress);
```

### `createChannel(options?)`, `listChannels()`, `deleteChannel(channelId)`

Channel management hits the separate `api-manage-broadcast.{sandbox.,}push.apple.com` host (see [Environments and endpoints](#environments-and-endpoints)).

```ts
const channel = await client.createChannel({ storagePolicy: "no-storage" });
// → { channelId: "Wj9rT…==", storagePolicy: "no-storage", raw?: {...} }

const all = await client.listChannels();
// → ChannelInfo[]

await client.deleteChannel(channel.channelId);
```

`storagePolicy` defaults to `"no-storage"`. `"most-recent-message"` keeps the last broadcast for late-joining devices, at the cost of stricter `apns-expiration` rules.

### `close()`

Tear down the HTTP/2 sessions. Always call this in shutdown handlers; the long-lived sessions otherwise keep the process alive.

```ts
process.on("SIGTERM", async () => {
  await client.close();
  process.exit(0);
});
```

### Error class hierarchy

Every non-2xx APNs response throws a typed subclass of `ApnsError`. Each instance carries `reason`, `status`, `apnsId`, and `timestamp`. The full set, mirroring `packages/push/src/errors.ts`:

| Subclass | Reason string | When |
| --- | --- | --- |
| `BadDeviceTokenError` | `BadDeviceToken` | Token / environment mismatch. |
| `InvalidProviderTokenError` | `InvalidProviderToken` | JWT rejected (key id, team id, or .p8 wrong). |
| `ExpiredProviderTokenError` | `ExpiredProviderToken` | JWT older than 1 hour (clock skew). |
| `TopicDisallowedError` | `TopicDisallowed` | Auth key not enabled for this bundle id. |
| `UnregisteredError` | `Unregistered` | Device, per-activity, or push-to-start token is permanently dead (410). Drop from your token store. |
| `ForbiddenError` | `Forbidden` | Auth key was revoked in the Apple Developer portal. Mint a new one and rotate `APNS_KEY_ID` / `APNS_KEY_PATH`. |
| `PayloadTooLargeError` | `PayloadTooLarge` | Activity payload > 4 KB (5 KB for broadcast). |
| `BadPriorityError` | `BadPriority` | Priority is not 5 or 10. |
| `BadExpirationDateError` | `BadExpirationDate` | `expirationSeconds` malformed. |
| `BadDateError` | `BadDate` | Other timestamp field malformed. |
| `MissingTopicError` | `MissingTopic` | `apns-topic` header missing. |
| `MissingChannelIdError` | `MissingChannelId` | `apns-channel-id` header missing on a broadcast/management call. |
| `BadChannelIdError` | `BadChannelId` | Channel id malformed or oversized. |
| `ChannelNotRegisteredError` | `ChannelNotRegistered` | Channel does not exist in this environment. |
| `CannotCreateChannelConfigError` | `CannotCreateChannelConfig` | 10,000-channel limit reached for the bundle id. |
| `InvalidPushTypeError` | `InvalidPushType` | `apns-push-type` is wrong (channels accept only `liveactivity`). |
| `FeatureNotEnabledError` | `FeatureNotEnabled` | Broadcast capability not enabled on the auth key. |
| `MissingPushTypeError` | `MissingPushType` | `apns-push-type` header missing. |
| `TooManyRequestsError` | `TooManyRequests` | 429. `retryAfterSeconds` parsed from `Retry-After` when present. |
| `InternalServerError` | (5xx, no reason) | APNs internal error. Retried by the default policy; surface if it persists. |
| `ServiceUnavailableError` | (503) | APNs unavailable. Retried by the default policy. |
| `UnknownApnsError` | (any other) | Reason not in the local guide. Raw reason preserved on `.reason`. |

Five non-APNs errors complete the picture:

| Class | When |
| --- | --- |
| `InvalidSnapshotError` | Snapshot failed `liveSurfaceSnapshot.safeParse`, or `kind` is not allowed for the chosen method (e.g. calling `update` with a `widget`-kind snapshot). Carries `issues: readonly string[]` for ergonomic logging. Thrown **before any network call**. |
| `MissingApnsConfigError` | `createPushClient` was called with one of `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_KEY_PATH` / `APNS_BUNDLE_ID` unset or empty. Thrown at construction time so the failure surfaces before the first send. |
| `CreateChannelResponseError` | `createChannel` succeeded over the wire (2xx) but the response carried no usable channel id. Carries `bodySnippet` (truncated to 200 chars) for post-hoc debugging. |
| `ClientClosedError` | Any send/manage method called after `close()`. |
| `AbortError` | A send was canceled via the `AbortSignal` passed in `SendOptions.signal`. |

### Retry policy

The default policy retries up to **3 times** with exponential backoff (**100 ms** base, **5 s** cap, jitter on) for:

- `TooManyRequests` (honors the `Retry-After` header when present)
- `InternalServerError`
- `ServiceUnavailable`
- transport-level errors: `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`, `ENETUNREACH`, `EHOSTUNREACH`, `NGHTTP2_REFUSED_STREAM`

Override at construction time:

```ts
import { createPushClient, DEFAULT_RETRY_POLICY } from "@mobile-surfaces/push";

const client = createPushClient({
  // ...
  _unsafeRetryOverride: {
    ...DEFAULT_RETRY_POLICY,
    maxRetries: 5,
    baseDelayMs: 250,
    retryableReasons: new Set(["TooManyRequests"]), // narrow the set
  },
});
```

The option is named `_unsafeRetryOverride` because changing it usually goes wrong: the defaults are tuned against MS015's iOS budget rules and the priority-aware stretch. The legacy name `retryPolicy` still works in 5.x but logs a one-time deprecation warning per process; it will be removed in 6.0.

For incidents, set the env var `MOBILE_SURFACES_PUSH_DISABLE_RETRY=1` (or any non-empty value) to force `maxRetries: 0` across every client in the process. This wins over any in-code override — it's an operator kill-switch.

`computeBackoffMs` lives in `packages/push/src/retry.ts` if you want to reuse the same backoff math elsewhere; the default formula is `min(base * 2^attempt, max) + random(0, base)` with jitter.

### Priority-aware retry stretch

Per [MS015](/traps#ms015-push-priority-5-vs-10-budget-rules), priority 10 Live Activity sends are heavily budgeted by iOS. Sustained retries against an already-throttled token only deepen the throttle. The SDK applies a `effectiveRetryPolicy` stretch transparently for any send issued at priority 10:

| Field         | Priority 5 (Live Activity content updates) | Priority 10 (alerts, state transitions) |
| ------------- | ------------------------------------------ | --------------------------------------- |
| `maxRetries`  | configured value (default 3)               | `min(configured, 2)` — hard ceiling 2   |
| `baseDelayMs` | configured value (default 100)             | `configured * 2`                        |
| `maxDelayMs`  | configured value (default 5000)            | `configured * 2`                        |

The stretch is one-way: it can only narrow `maxRetries` and widen the delay windows. If you set `maxRetries: 1`, priority 10 still honors `1` rather than expanding to `2`. The function is exported as `effectiveRetryPolicy(base, priority)` so callers can audit what the SDK will actually do.

Channel-management ops (`createChannel`, `listChannels`, `deleteChannel`) and any send not explicitly carrying `priority: 10` use the base policy unmodified.

## Channel push (iOS 18+)

iOS 18 introduced **broadcast channels**: a single channel can fan out one Live Activity update to every device that opted in, instead of paying per-device send costs. There are three pieces.

### Device-side opt-in

The harness opts a Live Activity into channel mode by passing `channelId` to `liveActivityAdapter.start(...)`:

```ts
import { liveActivityAdapter } from "../src/liveActivity"; // boundary re-export

await liveActivityAdapter.start(
  surfaceId,
  modeLabel,
  contentState,
  channelId, // optional fourth arg; iOS < 18 throws ACTIVITY_UNSUPPORTED_FEATURE
);
```

iOS < 18 throws `ACTIVITY_UNSUPPORTED_FEATURE` rather than silently degrading. iOS 18+ routes the activity through `pushType: .channel(...)` and the backend can now broadcast to the matching channel id.

### Backend-side broadcast

```ts
const snapshot = surfaceFixtureSnapshots.activeProgress;
await client.broadcast(channelId, snapshot, {
  staleDateSeconds: Math.floor(Date.now() / 1000) + 3600,
});
```

Channels only support **update** semantics; `start` and `end` are not valid against a channel. Broadcast payloads are bounded at 5 KB (vs 4 KB per-activity).

### Channel management

```ts
// Create
const channel = await client.createChannel({ storagePolicy: "no-storage" });
// "most-recent-message" keeps the last broadcast available for late-joiners.

// List
const all = await client.listChannels();

// Delete
await client.deleteChannel(channel.channelId);
```

The smoke-script equivalents:

```bash
# Create (default storage policy is no-storage)
node scripts/send-apns.mjs --channel-action=create --env=development

# Create with the alternative storage policy
node scripts/send-apns.mjs --channel-action=create --storage-policy=most-recent-message --env=development

# List
node scripts/send-apns.mjs --channel-action=list --env=development

# Delete
node scripts/send-apns.mjs --channel-action=delete --channel-id=<base64> --env=development
```

Channels are environment-scoped: a channel created with `--env=development` cannot be reached with `--env=production` (or vice versa). You will get `ChannelNotRegistered` if you cross the streams.

## Error responses

The full mapping mirrors `packages/push/src/reasons.ts` and `scripts/send-apns.mjs`'s `APNS_REASON_GUIDE`. The SDK exports a typed subclass per reason (see [Error class hierarchy](#error-class-hierarchy)) so callers can `instanceof`-narrow without parsing strings. Sixteen of the error classes are catalog-bound via `trapIdForErrorClass` (mapping to eleven distinct trap ids) and are the ones worth alerting on in production; see [`docs/observability.md`](/docs/observability) for the recommended log shape and signal-by-signal alerting playbook.

| Reason | Cause | Fix |
| --- | --- | --- |
| `BadDeviceToken` | Token / environment mismatch. | Use `environment: "development"` for dev-client / `expo run:ios` builds, `"production"` only for TestFlight / App Store builds. Tokens from one environment do not authenticate against the other. |
| `InvalidProviderToken` | JWT rejected by APNs. | Confirm `keyId` (10 chars), `teamId` (10 chars), and the `.p8` at `keyPath` all match the same auth key. JWTs are also rejected when local clock skew > ~1 hour; sync system time. |
| `ExpiredProviderToken` | JWT older than 1 hour. | The SDK refreshes JWTs every 50 minutes; this is almost always clock skew. Sync NTP and retry. |
| `TopicDisallowed` | Auth key not enabled for this bundle id, or `bundleId` is wrong. | For Live Activity pushes the topic is auto-suffixed with `.push-type.liveactivity`. Do not include that suffix in `bundleId`. |
| `Forbidden` | Auth key revoked. | Generate a new APNs auth key in the Apple Developer portal and update `keyPath` / `keyId`. |
| `BadPriority` | Priority is not 5 or 10. | Use priority 5 (default for Live Activity) or 10 (immediate user-visible). |
| `BadExpirationDate` | `expirationSeconds` is malformed. | Pass a positive unix-seconds integer. For broadcast on a No-Message-Stored channel, `apns-expiration` must be 0; Apple rejects nonzero expirations there (the SDK's `broadcast()` already sets 0). |
| `BadDate` | A timestamp field is malformed. | Same as `BadExpirationDate`; confirm `staleDateSeconds` / `dismissalDateSeconds` are unix-seconds integers. |
| `MissingTopic` | `apns-topic` header missing. | Set `bundleId` to your bundle identifier (without the `.push-type.liveactivity` suffix; the SDK appends it). |
| `PayloadTooLarge` | Activity payload > 4 KB (5 KB for broadcast). | Trim snapshot fields. ActivityKit content states are bounded; localization or long secondary text are the usual offenders. |
| `TooManyRequests` | Apple is rate-limiting your bundle id (or the Live Activity priority budget is exhausted). | Back off. Live Activity priority 10 has aggressive budgets; drop to 5 unless the update must be visible immediately. The SDK retries with `Retry-After` automatically when the header is present. |
| `MissingChannelId` | `apns-channel-id` header is missing. | Pass `channelId` to `broadcast()` or `deleteChannel()`. The header is set automatically when the argument is provided. |
| `BadChannelId` | `apns-channel-id` is malformed or oversized. | Channel ids are base64-encoded strings returned by `createChannel()`. Don't truncate, URL-decode, or re-encode them; pass the value through as-is. |
| `ChannelNotRegistered` | The channel id does not exist. | Channels are environment-scoped; a channel created in `development` cannot be reached in `production`. Re-create in the target environment, or `listChannels()` to confirm. |
| `InvalidPushType` | `apns-push-type` is wrong. | Channel sends require `liveactivity`. The SDK always sets this; if you reach this from a custom payload, drop the override. |
| `CannotCreateChannelConfig` | 10,000-channel limit reached. | Audit with `listChannels()` and `deleteChannel()` stale ones before creating new channels. |
| `FeatureNotEnabled` | Broadcast capability not enabled for this bundle id. | Enable broadcast for the auth key in the Apple Developer portal (Certificates, Identifiers & Profiles > Keys). The capability is per-key, not per-app. |
| `MissingPushType` | `apns-push-type` header missing. | The SDK sets this automatically; if you see it from a custom payload, restore the default. |
| `InternalServerError` | APNs internal error. | Retry with backoff. The default retry policy already handles this. |
| `ServiceUnavailable` | APNs temporarily unavailable. | Retry with backoff. The default retry policy already handles this. |

## Smoke script reference

`scripts/send-apns.mjs` is the canonical wire-shape reference. It supports six modes; pick by the lead flag.

| Mode | Lead flag | Required additions | Output target |
| --- | --- | --- | --- |
| Alert | `--type=alert` | `--device-token=<hex>` | `POST /3/device/<token>` |
| Live Activity update/end | `--type=liveactivity --activity-token=<hex>` | `--event=update|end` | `POST /3/device/<token>` |
| Live Activity remote start | `--type=liveactivity --push-to-start-token=<hex>` | `--event=start --attributes-file=…` | `POST /3/device/<token>` |
| Broadcast | `--type=liveactivity --channel-id=<base64>` | `--event=update` | `POST /4/broadcasts/apps/<bundle-id>` |
| Channel: create | `--channel-action=create` | (`--storage-policy=no-storage|most-recent-message`) | `POST /1/apps/<bundle>/channels` on management host |
| Channel: list | `--channel-action=list` | - | `GET /1/apps/<bundle>/all-channels` on management host |
| Channel: delete | `--channel-action=delete` | `--channel-id=<base64>` | `DELETE /1/apps/<bundle>/channels` on management host |

### Common flags

- `--env=development|production`: picks the host pair (default `development`).
- `--snapshot-file=./data/surface-fixtures/active-progress.json`: load a `LiveSurfaceSnapshot` from disk; the script projects it through `toApnsAlertPayload` or `toLiveActivityContentState` as appropriate.
- `--state-file=./scripts/sample-state.json`: bypass the projection and ship a raw ActivityKit `content-state` JSON. Useful for testing renderer behavior without going through the contract.
- `--attributes-file=…`: required for `--event=start`. JSON file with `surfaceId` and `modeLabel`. The surface fixtures match this shape.
- `--attributes-type=MobileSurfacesActivityAttributes`: override the type name after `pnpm surface:rename`.
- `--stale-date=<unix-seconds>`: ActivityKit `stale-date` aps field.
- `--dismissal-date=<unix-seconds>`: ActivityKit `dismissal-date`. Defaults to now on `--event=end`.
- `--priority=5|10`: `apns-priority`. Defaults: 5 for `liveactivity`, 10 for `alert`.

### Worked example: end-to-end remote start

```bash
# 1. Read the push-to-start token from the harness logs (onPushToStartToken).
# 2. Send the start push.
node scripts/send-apns.mjs \
  --type=liveactivity \
  --push-to-start-token=<hex> \
  --event=start \
  --snapshot-file=./data/surface-fixtures/queued.json \
  --attributes-file=./data/surface-fixtures/queued.json \
  --env=development
# 3. Read the per-activity push token from the harness "All active activities".
# 4. Update the activity.
node scripts/send-apns.mjs \
  --type=liveactivity \
  --activity-token=<hex> \
  --event=update \
  --snapshot-file=./data/surface-fixtures/active-progress.json \
  --env=development
# 5. End the activity.
node scripts/send-apns.mjs \
  --type=liveactivity \
  --activity-token=<hex> \
  --event=end \
  --snapshot-file=./data/surface-fixtures/completed.json \
  --env=development
```

The script prints the HTTP status, request topic, push-type, payload, and any APNs response body. On non-2xx responses it appends the matching `APNS_REASON_GUIDE` entry, so you do not need to switch tabs to debug a 400 / 403 / 410. It also warns on >5 minute clock skew detected from the `Date` response header.

## What the SDK does not expose

Knobs the SDK intentionally does not surface, with the reason in each row. Open an issue if you need one of these wired through; the contract is bridge-agnostic so a fork can land them without breaking other consumers.

- **Compact-trailing custom images, `ActivityUIDismissalPolicy.after`, and other ActivityKit knobs Apple has added since iOS 16.2** beyond `staleDate` and `relevanceScore`. The bridge is intentionally narrow; the trap catalog lists what is enforced, everything else is unwrapped.
- **`signal: AbortSignal`** is exposed on every send method (`alert`, `sendNotification`, `update`, `start`, `end`, `broadcast`) and on each channel-management call. When aborted, an in-flight request is cancelled via `NGHTTP2_CANCEL`; a request waiting in a retry-backoff sleep wakes immediately; the promise rejects with the signal's reason or a generic `AbortError`. Pre-aborted signals reject synchronously without dialing.
- **`describeSend(input)`** is a side-effect-free preview of the exact request a matching `send()` would issue (method, path, headers, payload, byte count). No JWT mint, no socket open. Useful for compose-time MS011 checks and `send-apns.mjs --describe`.
- **`MOBILE_SURFACES_PUSH_DISABLE_RETRY`** env-var kill switch forces `maxRetries: 0` regardless of `_unsafeRetryOverride`. Documented because operators occasionally want to bisect "is this my retry policy or APNs?" without redeploying.
- **`caOverride`** on `createPushClient` accepts a self-signed CA bundle. Test-only knob — the TLS regression test points the client at an in-process h2 server. Production callers never set this.

## Anti-goals

- **No production-shaped backend example.** That belongs in [`packages/push/README.md`](https://github.com/glendonC/mobile-surfaces/blob/main/packages/push/README.md). This page is the reference for what the SDK and the script *do*; wiring the SDK into a queue, retry queue, or CDC pipeline is application-specific.
- **No restating ActivityKit concepts the SDK already abstracts.** The SDK builds correct `aps` blocks, picks topics and priorities, sets `apns-expiration`, and chooses dismissal defaults; the doc does not relitigate those.
- **No paraphrasing of Apple's docs.** Every reason string and endpoint here is verified against current Apple documentation; the reason text is consistent with `packages/push/src/reasons.ts` (the canonical local copy).
