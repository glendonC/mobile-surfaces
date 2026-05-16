---
"@mobile-surfaces/push": minor
---

Two additive hardening changes to the APNs SDK:

1. **HTTP/2 concurrent-stream cap with FIFO queue.** Adds `maxConcurrentStreams` to `createPushClient` (default `900`). The effective cap is `min(option, peer's SETTINGS frame, 900)`; excess requests wait in a FIFO queue and dispatch as in-flight streams complete. Aborts while queued short-circuit without opening a stream; `close()` rejects every queued request with `ClientClosedError`. The cap applies independently to the send origin and the channel-management origin. Pass `0` to opt out — the SDK then dispatches without a cap, matching the pre-7.2 behavior.

2. **`JwtCacheLike` strategy pattern for multi-worker / multi-replica deployments.** Adds a `jwtCache` option to `createPushClient` that accepts any `{ get(): string | Promise<string>; invalidate(): void | Promise<void> }`. When set, the SDK skips its built-in in-memory cache and uses the injected implementation for every provider-token mint; `keyId`, `teamId`, and `keyPath` become optional because the SDK no longer needs the auth-key material. Lets cluster-mode senders coordinate a single mint via `BroadcastChannel`, IPC, or a Redis-backed read-through cache, instead of paying for N independent ES256 signs every 50 minutes. The default `JwtCache` is now exported (it itself implements `JwtCacheLike`, so consumers can wrap it).

See `packages/push/README.md` "Concurrent-stream cap" and "Operational notes" for the cap defaults and a worked `BroadcastChannel` example.
