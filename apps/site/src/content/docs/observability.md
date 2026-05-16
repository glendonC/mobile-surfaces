---
title: "Observability"
description: "Which catalog-bound errors are worth alerting on, hook signatures, recommended log shape."
order: 50
group: "Operate"
---
# Observability

The Mobile Surfaces pitch is that iOS Live Activities silently fail. The push returns HTTP 200, the app compiles, the Lock Screen stays on its old state, and nothing in your stack tells you why. This page documents the seams the SDK exposes so a backend running real traffic can detect those failures from logs and metrics instead of waiting for support tickets.

Everything below is wire- and event-layer instrumentation. It does not replace device-side QA, and it does not paper over the trap catalog. It tells you which catalog rule has fired in production so you can act before the user notices.

## What the SDK exposes

`@mobile-surfaces/push` exposes two hook callbacks on `createPushClient`. Both fire once per attempt, before the SDK decides to retry.

```ts
import { createPushClient, trapIdForErrorClass } from "@mobile-surfaces/push";

const client = createPushClient({
  keyId, teamId, keyPath, bundleId,
  environment: "production",
  hooks: {
    onResponse: (ctx) => {
      // Fires after every 2xx, once per attempt.
      // ctx: { operation, attempt, isFinalAttempt, apnsId, status, token,
      //        snapshotId, durationMs }
    },
    onError: (err, ctx) => {
      // Fires after every thrown error (transport or APNs non-2xx), once
      // per attempt. isFinalAttempt: false means the SDK will retry;
      // isFinalAttempt: true means the caller will see this error.
      const trapId = err instanceof Error ? trapIdForErrorClass(err.constructor.name) : undefined;
      // trapId is non-undefined for the catalog-bound subset (MS011, MS014,
      // MS015, MS018, MS020, MS028, MS030, MS031, MS032, MS034, MS035).
      // Treat those as silent-failure signals; treat the rest as wire-layer
      // noise. The authoritative map lives in packages/push/src/trap-bindings.ts.
    },
  },
});
```

There is intentionally no `onRetry`: the same `onError` fires with `isFinalAttempt: false` for each retried attempt and `isFinalAttempt: true` for the one the caller will actually observe. Deduplicating on `apnsId` collapses the per-attempt fan-out when you only want one event per logical send.

### Hook context fields

| Field            | Type                       | Notes                                                              |
| ---------------- | -------------------------- | ------------------------------------------------------------------ |
| `operation`      | `PushHookOperation`        | `alert` `update` `start` `end` `broadcast` `createChannel` `listChannels` `deleteChannel`. New operations append, never rename. |
| `attempt`        | `number`                   | Zero-indexed. Attempt 0 is the first try.                          |
| `isFinalAttempt` | `boolean`                  | `false` while the SDK still has retries; `true` on the attempt the caller sees. |
| `apnsId`         | `string` (UUID v4)         | `apns-id` of the request. Use this to correlate retries.            |
| `status`         | `number` (undefined on transport errors) | HTTP status code from APNs.                             |
| `token`          | `string` (undefined for management ops) | Device, push-to-start, or channel id. **Unredacted; redact before logging.** |
| `snapshotId`     | `string` (sends only)      | `liveSurfaceSnapshot.id`. Useful for correlating with producer logs. |
| `durationMs`     | `number`                   | Wall-clock from request issue to response (or thrown error).        |

### Error classes worth observing

`@mobile-surfaces/push/trap-bindings` exports `trapIdForErrorClass(name)`. The catalog-bound error classes are:

| Error class                   | Trap id | What it means                                                        |
| ----------------------------- | ------- | -------------------------------------------------------------------- |
| `BadChannelIdError`           | MS031   | Channel id is malformed on the wire (URL-decoded, truncated, or otherwise mutated). |
| `BadDateError`                | MS032   | A Live Activity date field is not a positive unix-seconds integer.   |
| `BadDeviceTokenError`         | MS014   | Token environment mismatches build environment (dev vs prod).        |
| `BadExpirationDateError`      | MS032   | `apns-expiration` is invalid for the channel storage policy (broadcast on a no-storage channel must be 0). |
| `ChannelNotRegisteredError`   | MS031   | Channel id refers to a channel that does not exist in this environment. |
| `ExpiredProviderTokenError`   | MS030   | JWT older than 60 minutes. SDK auto-refreshes at 50; if you see this, the process clock is skewed or the client has been held past its refresh budget. |
| `FeatureNotEnabledError`      | MS034   | The auth key lacks the 'Broadcast to Live Activity' capability.      |
| `ForbiddenError`              | MS030   | Auth key revoked in the Apple Developer portal.                      |
| `InvalidProviderTokenError`   | MS030   | JWT signed with the wrong key id or team id.                         |
| `MissingApnsConfigError`      | MS028   | A required env var was unset at `createPushClient` time.             |
| `MissingChannelIdError`       | MS031   | `broadcast()` or `deleteChannel()` was called without `channelId`.   |
| `MissingTopicError`           | MS035   | `apns-topic` header is missing; `APNS_BUNDLE_ID` was unset or empty. |
| `PayloadTooLargeError`        | MS011   | Snapshot serialized over 4 KB (per-activity) or 5 KB (broadcast).    |
| `TooManyRequestsError`        | MS015   | iOS is throttling priority-10 Live Activity pushes.                  |
| `TopicDisallowedError`        | MS018   | `APNS_BUNDLE_ID` includes the `.push-type.liveactivity` suffix (the SDK auto-appends it). |
| `UnregisteredError`           | MS020   | Token is dead. Either user uninstalled or per-activity token rotated. |

Errors without a trap id (`BadPriorityError`, `InternalServerError`, etc.) are wire-layer or SDK-self-correctness issues. Log them, but a non-zero rate is not by itself a catalog violation.

## Standard log shape

The minimum a sensible log line carries:

```ts
function logPushEvent(level: "info" | "warn" | "error", ctx: PushHookContext, extra: Record<string, unknown> = {}) {
  logger[level]({
    operation: ctx.operation,
    apns_id: ctx.apnsId,
    attempt: ctx.attempt,
    final_attempt: ctx.isFinalAttempt,
    status: ctx.status,
    duration_ms: ctx.durationMs,
    snapshot_id: ctx.snapshotId,
    token_fingerprint: ctx.token ? hashToken(ctx.token) : undefined,
    ...extra,
  });
}
```

`hashToken` is the consumer's call. SHA-256 of the token truncated to the first 12 hex chars is a defensible default: enough collision resistance to bucket per-token rate, not enough to leak. Never log the raw token; APNs device tokens, push-to-start tokens, and the JWT are all credentials.

## Signals worth alerting on

These are the patterns that turn "everything fails silently" into a paged incident before users notice.

### Catalog-bound error rate (the primary silent-failure signal)

```ts
onError: (err, ctx) => {
  const trapId = err instanceof Error ? trapIdForErrorClass(err.constructor.name) : undefined;
  if (trapId && ctx.isFinalAttempt) {
    metrics.increment("push.catalog_error", { trap: trapId, operation: ctx.operation });
  }
},
```

Alert on any sustained non-zero rate per `trap` label. The catalog-bound subset is exactly the set of errors that map to a known iOS silent-failure mode. A trap-bound error rate above your baseline is the strongest single signal that the fix instructions in `data/traps.json` are applicable.

### `BadDeviceToken` and `Unregistered` ratio creep

`BadDeviceToken` (MS014) and `Unregistered` (MS020) both mean "this token cannot be sent to." Treat them together as a token-staleness rate:

```
stale_token_rate = (count(BadDeviceToken) + count(Unregistered)) / count(send_attempts)
```

A healthy production token store stays below roughly 5% sustained. Above that, your backend is holding tokens past their lifetime: app uninstalls, environment mismatches between dev-client and TestFlight installs, or per-activity tokens that were never evicted when the activity ended. Wire token eviction to `UnregisteredError` and to the device-side `onActivityStateChange` terminal states (`ended` / `dismissed`); see [`docs/push.md#token-taxonomy`](/docs/push#token-taxonomy).

### `TooManyRequests` bursts

`TooManyRequestsError` (MS015) means iOS has throttled your priority-10 Live Activity sends. The wire response carries `Retry-After`; the SDK honors it for the retry but a burst means your priority discipline is wrong. Priority 10 is for state-transition pushes the user must see immediately; priority 5 is for content-state ticks. Default the priority field to 5 except on transitions and the burst rate drops to ambient.

### `PayloadTooLarge`

`PayloadTooLargeError` (MS011) is checked client-side before the dial, so the SDK throws synchronously. It means a snapshot serialized over the 4 KB (per-activity) or 5 KB (broadcast) ceiling. The fix is on the producer, not the network: trim `liveActivity.body`, lower `liveActivity.morePartsCount`, or split a state into two smaller pushes. Alert on any non-zero rate; this is a producer bug, not a degradation.

### `Expired` / `Invalid` / `Forbidden` provider token

All three map to MS030 but mean three different operator responses:

- `ExpiredProviderToken` -> system clock is skewed or `createPushClient` was held past its refresh budget. Verify NTP; bounce long-lived processes if you cannot guarantee they re-mint.
- `InvalidProviderToken` -> `APNS_KEY_ID` does not match the loaded `.p8`, or `APNS_TEAM_ID` does not match the developer account. The fix is config, not retry.
- `Forbidden` -> the auth key was revoked in the Apple Developer portal. Mint a new key.

Split these in your alerting; one common label loses the operator distinction.

## Stuck Live Activity

The prototypical silent failure: APNs returns 200 on every `update`, but the device's Lock Screen stays on its old `ContentState`. There is no error class for this and no wire signal that distinguishes it from healthy sends. Detection requires correlating two streams:

1. Backend: `onResponse` rate per `snapshotId` from `operation: "update"` sends.
2. Device: `onActivityStateChange` and the App Group snapshot key (`surface.snapshot.<surfaceId>`).

When 200s keep landing but the device-observed snapshot for the same `surfaceId` does not advance, you are hitting one of:

- A field shape mismatch between Swift `ContentState` and the Zod `liveSurfaceActivityContentState` projection (MS003, decoder silently fails on a renamed key).
- A `kind`/slice mismatch in your projection helper (MS008, snapshot rejected before push but logged ambiguously).
- An out-of-order push older than the snapshot already applied (which is exactly what `updatedAt` exists to detect; comparison must happen client-side).

The on-device telemetry to ship is sparse but high-signal: a single counter incremented from the harness for every received `onActivityStateChange` keyed by `(surfaceId, state, updatedAt)`, surfaced via your existing app-side analytics. Cross-reference with backend `apns_id` per snapshot to spot the gap.

## On-device observability

Three event streams from `@mobile-surfaces/live-activity` map to backend state your service should track.

```ts
// apps/mobile/src/screens/LiveActivityHarness.tsx is the reference consumer.
LiveActivity.addListener("onPushToken", ({ activityId, token }) => {
  // Per-activity token. Fires once at start, then on rotation. Re-store on
  // every emission; treat tokens as activity-scoped.
});

LiveActivity.addListener("onPushToStartToken", ({ token }) => {
  // App-level push-to-start token (iOS 17.2+). Fires at mount and on system
  // rotation. Re-store on every emission keyed by user/device id.
});

LiveActivity.addListener("onActivityStateChange", ({ activityId, state }) => {
  // state: "active" | "ended" | "dismissed" | "stale" | "pending" | "unknown"
  // The "unknown" branch fires on ActivityKit cases Apple adds after the
  // current SDK version. Log it so future schema additions are observable
  // before they bite. "ended" and "dismissed" are terminal: drop the
  // per-activity token from your store.
});
```

Two metrics derived from these streams are worth shipping:

- **Token rotation rate.** Every `onPushToken` and `onPushToStartToken` emission is a chance to drop a stored token on the floor if the consumer fails to update. A non-zero ratio between observed rotations and backend token-store updates is a load-bearing miss.
- **Unknown-state count.** A non-zero `state: "unknown"` rate means Apple has added an `ActivityState` case the SDK does not handle explicitly. The TS event union widens are tracked in `packages/live-activity/src/index.ts`; an alert here is the prompt to file a follow-up.

### App Group probe

`apps/mobile/src/diagnostics/checkSetup.ts` writes a probe value under `diagnostic.appGroupProbe` to verify the App Group container is reachable. The widget-side reader pulls it through `MobileSurfacesSharedState`. A read miss is MS013 (App Group identifier mismatch) firing live on a user's device. Surface it through your in-app diagnostic before the user files a "widget shows placeholder" report.

## What to redact

The Mobile Surfaces `scripts/lib/redact.mjs` defines the redaction pattern used by `pnpm surface:diagnose`. The same rules apply to push hooks:

- **Device tokens, push-to-start tokens, channel ids.** Log a stable fingerprint, not the value.
- **JWT (provider token).** Never logged; the SDK never exposes it through hooks anyway.
- **PEM blocks.** Auth-key contents must never reach a log line.
- **APNs auth values (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_PATH`).** Report only as `set` / `unset` in diagnostic bundles. The SDK validates presence at construction time; no need to echo the values back.

Path values referencing `$HOME` should be rewritten to `~/...` before any line leaves the process. Production logs read by anyone other than the original operator are public-issue-shaped.

## Cross-references

- [`docs/push.md`](/docs/push): the wire-layer reference, SDK API, error class hierarchy, retry policy.
- [`docs/troubleshooting.md`](/docs/troubleshooting): symptom-to-fix recipes for the runtime failures observable from these hooks.
- [`CLAUDE.md`](/traps) / [`AGENTS.md`](/traps): the trap catalog, generated from `data/traps.json`. Each catalog-bound error class above carries a `trapId` that links back to a rule with `summary` / `symptom` / `fix`.
