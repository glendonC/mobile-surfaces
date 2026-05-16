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
pnpm add @mobile-surfaces/push@5 @mobile-surfaces/surface-contracts@5
```

Requires Node 20+ (for stable HTTP/2 + native `crypto.randomUUID`). Surface contracts and push release together in the v5 linked group; pin to matching majors.

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
// v5: rendering fields live under per-kind slices.
//   snapshot.liveActivity.title
//   snapshot.liveActivity.body
//   snapshot.liveActivity.deepLink
//   snapshot.liveActivity.modeLabel

// Regular alert
await client.alert(deviceToken, snapshot);

// Live Activity content update
await client.update(activityToken, snapshot);

// iOS 17.2+ remote start (push-to-start token)
await client.start(pushToStartToken, snapshot, {
  surfaceId: snapshot.surfaceId,
  modeLabel: snapshot.liveActivity.modeLabel,
});

// End the activity
await client.end(activityToken, snapshot);

// iOS 18 broadcast on a channel
await client.broadcast(channelId, snapshot);

// Channel management
const channel = await client.createChannel({ storagePolicy: "no-storage" });
// channel.environment is "development" or "production" — channels are
// environment-scoped per MS031.
const channels = await client.listChannels();
await client.deleteChannel(channel.channelId);

await client.close();
```

Tokens in this example come from different places: `deviceToken` from normal APNs notification registration, `activityToken` from an active Live Activity, and `pushToStartToken` from ActivityKit's push-to-start token stream. See [`https://mobile-surfaces.com/docs/push`](https://mobile-surfaces.com/docs/push#token-taxonomy) for the full token lifecycle and [`https://mobile-surfaces.com/docs/ios-environment`](https://mobile-surfaces.com/docs/ios-environment#apns-environment) for matching `environment` to development vs production builds.

## Building APNs alert payloads from a snapshot

`toApnsAlertPayload` builds the `aps` envelope from a `liveActivity`-kind snapshot. It returns the strict shape `liveActivityAlertPayload` parses. Renamed from `liveActivityAlertPayloadFromSnapshot` in 5.0.0 for naming consistency with the `to*` projection helpers in `@mobile-surfaces/surface-contracts`.

```ts
import { toApnsAlertPayload } from "@mobile-surfaces/push";

if (snapshot.kind === "liveActivity") {
  const payload = toApnsAlertPayload(snapshot);
  // payload.aps.alert.title === snapshot.liveActivity.title
  // payload.aps.alert.body === snapshot.liveActivity.body
}
```

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

All carry `apnsId`, `status`, `timestamp`, and `reason`. The following additional classes round out the taxonomy:

- `InvalidSnapshotError` — Zod validation failure or wrong `kind`.
- `ClientClosedError` — method called after `close()`.
- `CreateChannelResponseError` — `createChannel()` 2xx response with no `apns-channel-id` recoverable from the headers or body (new in 5.0.0; previously a bare `Error`).
- `AbortError` — request was aborted via `options.signal` (new in 5.0.0). Covers in-flight cancellation, mid-backoff cancellation, and already-aborted signals uniformly.

## Retry behavior

The default policy retries up to 3 times with exponential backoff (100ms base, 5s cap, jitter on) for:

- `TooManyRequests` (honors `Retry-After`)
- `InternalServerError`
- `ServiceUnavailable`
- transport errors: `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`, `ENETUNREACH`, `EHOSTUNREACH`, `NGHTTP2_REFUSED_STREAM`
- **any** response with `status >= 500` (new in 5.0.0): bare 5xx responses with no parseable body, which previously short-circuited as `UnknownApnsError` and gave up after one attempt.

Priority 10 sends (the user-visible state transitions) get a tighter retry budget at runtime: `maxRetries` is clamped to 2 and the backoff windows are doubled, so sustained priority-10 retries cannot blow past APNs's budget (see MS015).

Backoff jitter shape (also new in 5.0.0): jitter is now applied **after** the exponential is clamped to `maxDelayMs`, not before. The previous shape collapsed every saturated retry to exactly the cap value, producing a thundering-herd risk when many clients retried the same incident in lockstep. The new ceiling at saturation is `maxDelayMs + baseDelayMs` (a small, deliberate overshoot that preserves jitter).

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

The name is deliberately ugly: the defaults are tuned against MS015 and the priority-aware stretch, and overriding them is usually wrong. The legacy `retryPolicy` option still works and logs a one-time deprecation warning per process.

`MOBILE_SURFACES_PUSH_DISABLE_RETRY=1` in the environment turns retries off entirely — useful for tests and for diagnosing whether a flake is APNs-side or your retry policy.

## Idempotency and retries

The SDK generates an `apns-id` (UUID v4) once per send call and reuses the same value across every retry attempt in that call's retry budget. APNs treats requests carrying the same `apns-id` as the same logical send and deduplicates them, so an SDK-level retry triggered by a transient `TooManyRequests` or transport reset does not enqueue a second update on the device.

Callers that need end-to-end at-least-once semantics across higher-level retries (process restart, queue replay) can pass their own `apnsId` via the send options. The SDK honors it as-is and reuses it for every retry in the same call. The returned `SendResult.apnsId` echoes whichever value was used.

## Cancellation

Every send and management method accepts an optional `signal: AbortSignal`:

```ts
const controller = new AbortController();
const inflight = client.alert(token, snapshot, { signal: controller.signal });
setTimeout(() => controller.abort(), 100);

try {
  await inflight;
} catch (err) {
  if (err instanceof AbortError) {
    // handled
  }
}
```

Behavior:
- An already-aborted signal rejects synchronously, before any TLS dial.
- Aborting an in-flight request cancels the HTTP/2 stream via `NGHTTP2_CANCEL`.
- Aborting during a retry-backoff sleep wakes the sleep and rejects.
- Aborting after a successful response is a no-op.

The thrown error is always `AbortError` (with the signal's `reason` carried as `cause`) regardless of which leg the abort landed on.

## Connection lifecycle

A single long-lived HTTP/2 session per (origin) is multiplexed across concurrent requests. The session auto-reconnects on `goaway` or socket close. After `idleTimeoutMs` (default 60s) of no in-flight requests, the session is closed; the next send re-opens it.

`client.close()` flushes in-flight requests, sets the client to closed, and tears down both sessions (send + management). Subsequent calls throw `ClientClosedError`. Graceful HTTP/2 close is bounded by `closeTimeoutMs` (default 5_000 ms); a stuck peer is force-destroyed rather than hanging teardown.

### Concurrent-stream cap

Each session multiplexes streams up to `maxConcurrentStreams` (default `900`). The effective cap is `min(maxConcurrentStreams, peer's SETTINGS frame, 900)` — Apple typically advertises 1000, and the 900 floor leaves headroom against peer-side enforcement variance. Excess requests wait in a FIFO queue and dispatch as in-flight streams complete; queue entries honor `AbortSignal` (an abort while queued short-circuits without opening a stream), and `client.close()` rejects every queued request with the closed error so teardown is never blocked by a long queue. Pass `0` to disable the queue entirely — the SDK then dispatches without a per-client cap and lets `NGHTTP2_REFUSED_STREAM` ride the normal retry loop.

## Operational notes

### Multi-worker JWT minting

`JwtCache` is a process-local cache. In a cluster-mode or `worker_threads` deployment, each worker holds its own cache and re-mints independently every 50 minutes — that is wasted compute (a handful of ES256 signs per hour per worker) but functionally correct. If your operating model requires a single mint shared across workers — or a Redis-backed cache that fronts an external coordinator — pass a custom implementation via the `jwtCache` option. When set, `keyId`, `teamId`, and `keyPath` become optional; the injected implementation owns mint, refresh, and dedup.

```ts
import { createPushClient, type JwtCacheLike } from "@mobile-surfaces/push";
import { BroadcastChannel } from "node:worker_threads";

// Leader-elected: the first worker to mint broadcasts the result; others
// await the next broadcast. Implementations are responsible for their own
// freshness (timer, expiry, retry-on-error) and concurrency (one in-flight
// mint at a time inside a single worker).
function createBroadcastJwtCache(mint: () => Promise<string>): JwtCacheLike {
  const channel = new BroadcastChannel("push-jwt");
  let cached: { token: string; iatMs: number } | undefined;
  let inflight: Promise<string> | undefined;
  channel.onmessage = (event) => {
    const data = event.data as { token: string; iatMs: number };
    if (!cached || data.iatMs > cached.iatMs) cached = data;
  };
  return {
    async get() {
      if (cached && Date.now() - cached.iatMs < 50 * 60 * 1000) return cached.token;
      if (inflight) return inflight;
      inflight = (async () => {
        const token = await mint();
        cached = { token, iatMs: Date.now() };
        channel.postMessage(cached);
        return token;
      })().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
    invalidate() {
      cached = undefined;
    },
  };
}
```

The exported `JwtCache` class is itself a `JwtCacheLike` implementation, so you can compose it (wrap the default cache with a `BroadcastChannel` listener, or front it with Redis SETNX) rather than re-implement minting from scratch.

## Next steps

- Read [`https://mobile-surfaces.com/docs/backend-integration`](https://mobile-surfaces.com/docs/backend-integration) for the full domain event to snapshot to APNs flow.
- Read [`https://mobile-surfaces.com/docs/push`](https://mobile-surfaces.com/docs/push) for retry policy, APNs hosts, token taxonomy, and smoke-script flags.
- Read [`https://mobile-surfaces.com/docs/troubleshooting`](https://mobile-surfaces.com/docs/troubleshooting) when APNs returns 200 but nothing appears on the Lock Screen.
