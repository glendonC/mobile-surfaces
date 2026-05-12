# Push

In plain English: this page explains how bytes travel from your backend to Apple's push servers, which token to use for each kind of push, and what to do when APNs rejects or accepts a request.

Deep reference for the wire layer: what `@mobile-surfaces/push` does, what tokens flow through it, where the APNs requests actually go, how to drive the iOS 18 broadcast/channel surface, and what every error reason means. The SDK is the recommended entry point; `scripts/send-apns.mjs` is the protocol-reference script kept self-contained so you can read the exact same wire shape top-to-bottom in a single file. Both target the same APNs endpoints and produce byte-equivalent payloads.

For the high-level "domain event → snapshot → APNs" tour, see [`docs/backend-integration.md`](./backend-integration.md). For the multi-kind contract and projection helpers, see [`docs/multi-surface.md`](./multi-surface.md).

## Token taxonomy

ActivityKit and APNs use three distinct token kinds. They are not interchangeable: each has its own source on iOS, its own lifetime, and its own use on the backend.

| Token | Source on iOS | iOS gate | Used for | Lifetime |
| --- | --- | --- | --- | --- |
| Device APNs token | `Notifications` permission grant + standard APNs registration | All supported versions | `client.alert(deviceToken, snapshot)`: plain alerts | Per device + app install. Rotates rarely. |
| Push-to-start token | `Activity<Attributes>.pushToStartTokenUpdates` async sequence | iOS 17.2+ | `client.start(pushToStartToken, snapshot, attributes)`: remote start | Per user / per `ActivityAttributes` type. May be re-issued at any time (cold launch, system rotation). |
| Per-activity push token | `activity.pushTokenUpdates` once iOS issues it after `Activity.request` | iOS 16.2+ (start), 17.2+ (remote start) | `client.update(activityToken, snapshot)`, `client.end(activityToken, snapshot)` | Per activity instance. Discard when the activity ends. |

### Where each token comes from in the harness

- **Device APNs token**: registered by the Expo runtime once notifications are granted. The harness shows it in the bottom row labeled "Device APNs token".
- **Push-to-start token**: the live-activity adapter (`apps/mobile/src/liveActivity/index.ts`) subscribes to `onPushToStartToken` at mount time and logs every value through. The contract for this event is documented in [`docs/architecture.md#adapter-contract`](./architecture.md#adapter-contract). Apple does not expose a synchronous query, so `getPushToStartToken()` always resolves `null`; production code subscribes to the event stream.
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
  idleTimeoutMs: 60_000,                  // close HTTP/2 session after this many ms idle
  // retry behavior is fixed internal: priority-10 sends get a stricter
  // back-off profile automatically. See "Retry policy" below for the
  // operational escape hatch (_unsafeRetryOverride and
  // MOBILE_SURFACES_PUSH_DISABLE_RETRY) — you almost never want it.
});
```

One client per `(auth-key, environment, bundleId)` tuple. A single client multiplexes alert / Live-Activity / broadcast / channel-management traffic over its session pool. `client.close()` flushes in-flight requests and tears down both HTTP/2 sessions; subsequent calls throw `ClientClosedError`.

### `alert(deviceToken, snapshot, options?)`

Plain alert push. Snapshot must be `kind: "liveActivity"`; payload is built via `toAlertPayload`.

```ts
import { surfaceFixtureSnapshots } from "@mobile-surfaces/surface-contracts";

await client.alert(deviceToken, surfaceFixtureSnapshots.attention, {
  priority: 10,                  // default 10 for alerts
  expirationSeconds: 1700003600, // default now + 3600
});
```

Returns a `PushResult`:

```ts
{
  apnsId: string;
  status: number;          // 2xx on success
  timestamp: Date;
  attempts: number;        // 1 on first-try success
  latencyMs: number;       // cumulative across attempts including backoff
  retried: ReadonlyArray<{ attempt, reason, backoffMs, trapId? }>;
  trapHits: ReadonlyArray<string>;  // unique trap ids surfaced during retries
}
```

`SendResponse` is kept as a deprecated alias for one minor. The retry tracker lets an AI consumer or test reconstruct what happened without subscribing to hooks.

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
    modeLabel: surfaceFixtureSnapshots.queued.modeLabel,
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
| `UnknownApnsError` | (any other) | Reason not in the local guide. Raw reason preserved on `.reason`. |

Two non-APNs errors complete the picture:

| Class | When |
| --- | --- |
| `InvalidSnapshotError` | Snapshot failed `liveSurfaceSnapshot.safeParse`, or `kind` is not allowed for the chosen method (e.g. calling `update` with a `widget`-kind snapshot). Carries `issues: readonly string[]` for ergonomic logging. Thrown **before any network call**. |
| `ClientClosedError` | Any send/manage method called after `close()`. |

### Retry policy

The default policy retries up to **3 times** with exponential backoff (**100 ms** base, **5 s** cap, jitter on) for:

- `TooManyRequests` (honors the `Retry-After` header when present)
- `InternalServerError`
- `ServiceUnavailable`
- transport-level errors: `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`, `ENETUNREACH`, `EHOSTUNREACH`, `NGHTTP2_REFUSED_STREAM`

**Priority-aware adjustment.** When `apns-priority: 10` hits a transient or throttled error and APNs hasn't supplied `Retry-After`, the SDK applies a stricter profile automatically: 2x base, 2x cap, `maxRetries` clamped to 2. Priority-5 sends use the base policy. This is fixed internal behavior (MS015) — there's no knob to tune it because the right values are not something a calling agent should have to reason about.

The retry tracker on `PushResult.retried` records every failed attempt with its reason, backoff, and trap id, so observability stays structured.

#### Operational escape hatch

You almost never want this. The defaults handle priority-aware throttling, honor `Retry-After`, and refuse to retry terminal reasons (`BadDeviceToken`, `Unregistered`, `PayloadTooLarge`, `TopicDisallowed`).

If you genuinely need to disable or tune retries — typically for tests that need deterministic timing, or SRE incident response — there are two escape hatches in order of precedence:

```ts
// 1. Runtime kill-switch (wins over everything). Sets maxRetries=0.
MOBILE_SURFACES_PUSH_DISABLE_RETRY=1 node your-app.js

// 2. Programmatic override at construction time. Named `_unsafe` because AI
//    consumers should avoid it; SRE humans find it via type completion.
import { createPushClient } from "@mobile-surfaces/push";

const client = createPushClient({
  // ...
  _unsafeRetryOverride: {
    maxRetries: 0,
    baseDelayMs: 1,
    jitter: false,
  },
});
```

The legacy `retryPolicy` option still works for one minor version but emits a one-time deprecation warning; migrate to `_unsafeRetryOverride`. The `DEFAULT_RETRY_POLICY` constant and the `RetryPolicy` type are still exported for callers who want to compose against the defaults.

### Introspection: `client.describeSend()`

Side-effect-free plan of what a send would do. Returns the request envelope (push type, topic, priority, payload bytes vs MS011 ceiling, effective retry policy, trap hits) without dispatching an HTTP request and without minting a JWT.

```ts
const plan = client.describeSend("update", surfaceFixtureSnapshots.activeProgress);
// {
//   operation: "update",
//   pushType: "liveactivity",
//   topic: "com.example.mobilesurfaces.push-type.liveactivity",
//   priority: 5,
//   payloadBytes: 412,
//   budgetLimit: 4096,
//   withinBudget: true,
//   trapHits: [],
//   effectiveRetryPolicy: { maxRetries: 3, baseDelayMs: 100, ... },
// }
```

Oversize payloads surface via `withinBudget: false` and `trapHits: ["MS011"]` rather than throwing `PayloadTooLargeError`. Invalid snapshots still throw `InvalidSnapshotError` — same contract as the live send. Useful for AI consumers verifying a snapshot before commit and for tests asserting the envelope shape without an APNs key.

`computeBackoffMs` lives in `packages/push/src/retry.ts` if you want to reuse the backoff math elsewhere; the formula is `min(base * 2^attempt, max) + random(0, base)` with jitter, on the effective (priority-adjusted) policy.

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

The full mapping mirrors `packages/push/src/reasons.ts` and `scripts/send-apns.mjs`'s `APNS_REASON_GUIDE`. The SDK exports a typed subclass per reason (see [Error class hierarchy](#error-class-hierarchy)) so callers can `instanceof`-narrow without parsing strings.

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

`scripts/send-apns.mjs` is a thin wrapper over `@mobile-surfaces/push` for one-off sends from the local machine. It supports six modes; pick by the lead flag. Every send requires `--snapshot-file` — for credential-only validation, use `pnpm surface:setup-apns` (it probes APNs sandbox with a fake token and reports auth issues without needing a real device token).

| Mode | Lead flag | Required additions | Output target |
| --- | --- | --- | --- |
| Alert | `--type=alert` | `--device-token=<hex> --snapshot-file=…` | `POST /3/device/<token>` |
| Live Activity update/end | `--type=liveactivity --activity-token=<hex>` | `--event=update|end --snapshot-file=…` | `POST /3/device/<token>` |
| Live Activity remote start | `--type=liveactivity --push-to-start-token=<hex>` | `--event=start --snapshot-file=… --attributes-file=…` | `POST /3/device/<token>` |
| Broadcast | `--type=liveactivity --channel-id=<base64>` | `--event=update --snapshot-file=…` | `POST /4/broadcasts/apps/<bundle-id>` |
| Channel: create | `--channel-action=create` | (`--storage-policy=no-storage|most-recent-message`) | `POST /1/apps/<bundle>/channels` on management host |
| Channel: list | `--channel-action=list` | - | `GET /1/apps/<bundle>/all-channels` on management host |
| Channel: delete | `--channel-action=delete` | `--channel-id=<base64>` | `DELETE /1/apps/<bundle>/channels` on management host |

### Common flags

- `--env=development|production`: picks the host pair (default `development`).
- `--snapshot-file=./data/surface-fixtures/active-progress.json`: load a `LiveSurfaceSnapshot` from disk; the script projects it through `toAlertPayload` or `toLiveActivityContentState` as appropriate. Required for every send.
- `--attributes-file=…`: required for `--event=start`. JSON file with `surfaceId` and `modeLabel`. The surface fixtures match this shape.
- `--attributes-type=MobileSurfacesActivityAttributes`: override the type name after `pnpm surface:rename`.
- `--stale-date=<unix-seconds>`: ActivityKit `stale-date` aps field.
- `--dismissal-date=<unix-seconds>`: ActivityKit `dismissal-date`. Defaults to now on `--event=end`.
- `--priority=5|10`: `apns-priority`. Defaults: 5 for `liveactivity`, 10 for `alert`.
- `--print` (or `--describe`): side-effect-free plan mode. Calls `client.describeSend()` and prints the envelope (topic, push type, priority, payload bytes vs MS011 ceiling, effective retry policy, trap hits) without dispatching. Exits 0 even if the snapshot would oversize — surfaces as `withinBudget: false`.
- `--json`: deterministic machine-readable stdout. Send results emit `{ ok, apnsId, status, attempts, latencyMs, retried, trapHits, ... }`; errors emit `{ ok: false, error: { message, reason?, trapId?, docsUrl?, fix? } }`. Human-readable output goes to stderr.

Exit codes: `0` success, `1` operational failure (APNs rejected, network), `2` usage/validation error (bad flags, missing env). Reason details live in stderr or the `--json` body, not in the exit code.

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

The script prints the HTTP status, request topic, push-type, payload byte count, request attempts, and any retry events. On non-2xx responses it appends the matching `APNS_REASON_GUIDE` entry plus the error's `docsUrl`, so you do not need to switch tabs to debug a 400 / 403 / 410. Pass `--print` to see the same envelope without dispatching the request, or `--json` for machine-readable output.

## Anti-goals

- **No production-shaped backend example.** That belongs in [`packages/push/README.md`](../packages/push/README.md). This page is the reference for what the SDK and the script *do*; wiring the SDK into a queue, retry queue, or CDC pipeline is application-specific.
- **No restating ActivityKit concepts the SDK already abstracts.** The SDK builds correct `aps` blocks, picks topics and priorities, sets `apns-expiration`, and chooses dismissal defaults; the doc does not relitigate those.
- **No paraphrasing of Apple's docs.** Every reason string and endpoint here is verified against current Apple documentation; the reason text is consistent with `packages/push/src/reasons.ts` (the canonical local copy).
