# @mobile-surfaces/tokens

## 7.1.0

### Minor Changes

- c347e54: v3 codec retirement. Per the versioning charter, a deprecated codec lives for at least one major past the release that deprecated it; v3 was first deprecated at 5.0 and ages out at 8.0.

  surface-contracts drops `liveSurfaceSnapshotV3`, `migrateV3ToV4`, `LiveSurfaceSnapshotV3`, the `V3_DEPRECATION_WARNING` constant, and the v3 branch in `safeParseAnyVersion`. The codec chain narrows to v5 → v4. The v4 codec's deprecation prose moves from "removed in 8.0.0" to "removed in 9.0.0" so the MS042 gate stays satisfied.

  Consumers with v3 payloads at rest must pin `@mobile-surfaces/surface-contracts@7.x` once, run `safeParseAnyVersion` to promote v3 → v5, store the result, then upgrade.

  `schemaVersion` stays at `"5"`. This release is codec retirement, not a wire-format bump.

  `@mobile-surfaces/validators` and `@mobile-surfaces/traps` cut majors in lockstep per the linked release group with no API change of their own.

  `@mobile-surfaces/push`, `@mobile-surfaces/live-activity`, `@mobile-surfaces/tokens`, and `create-mobile-surfaces` cut minors for the linked dependency range update; no API change.

### Patch Changes

- Updated dependencies [c347e54]
  - @mobile-surfaces/surface-contracts@8.0.0
  - @mobile-surfaces/traps@8.0.0
  - @mobile-surfaces/live-activity@7.1.0

## 7.0.0

### Major Changes

- Initial release. `@mobile-surfaces/tokens` owns the lifecycle semantics for ActivityKit per-activity push tokens, push-to-start tokens, and APNs device tokens. The package codifies MS020 (latest-write-wins on rotation) and MS021 (terminal lifecycle when an Activity ends) so app code doesn't re-invent the bookkeeping at every call site.

- Exports:

  - `createTokenStore(opts)` — vanilla token store with a multi-activity `Map<key, TokenRecord>`. Lifecycle states are `active | ending | dead`. Pluggable `TokenStorage` interface; default in-memory.
  - `useTokenStore({ adapter, environment, storage?, forwarder? })` — React hook (sub-path `@mobile-surfaces/tokens/react`) that subscribes to `onPushToken`, `onPushToStartToken`, and `onActivityStateChange` at mount. Upserts on every emission; marks tokens dead on terminal states.
  - `createTokenForwarder({ url, fetch, headers, maxRetries, timeoutMs, signal })` — HTTP forwarder that mirrors the push SDK's retry shape (sub-path `@mobile-surfaces/tokens/forwarder`). Idempotency key = `sha256(kind:activityId:token)` so retries dedupe at the backend.
  - Storage adapters under `./storage/memory`, `./storage/async-storage`, `./storage/secure-store`. Each is a sub-path export with an optional peer dependency declared in `peerDependenciesMeta`.
  - Wire-format Zod schemas under `./wire` for backends that validate forwarded payloads at the boundary.

- Pairs with the new MS039 static gate (`scripts/check-token-discipline.mjs`): application code under `apps/*/src/` must subscribe to ActivityKit token events through this package, not via direct `adapter.addListener` calls. The check allowlists the package implementation itself.

- The package depends on `@mobile-surfaces/surface-contracts` and `@mobile-surfaces/traps` at `workspace:^` and versions independently of the linked release group per the v7 charter.
