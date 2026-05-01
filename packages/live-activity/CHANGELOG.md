# @mobile-surfaces/live-activity

## 1.2.0

### Minor Changes

- 2de238f: Tighten `liveSurfaceSnapshot` into a true `kind`-discriminated union and add a v0→v1 migration codec.

  - `liveSurfaceSnapshot` is now `z.discriminatedUnion("kind", [...])` over six per-kind variants. Each variant requires its own slice (`widget`, `control`, `notification`) where applicable, so `{kind: "control"}` without a `control` slice no longer parses.
  - Per-kind variant schemas (`liveSurfaceSnapshotLiveActivity`, `liveSurfaceSnapshotWidget`, `liveSurfaceSnapshotControl`, `liveSurfaceSnapshotNotification`, `liveSurfaceSnapshotLockAccessory`, `liveSurfaceSnapshotStandby`) and their inferred types are now exported.
  - A `.preprocess` wrapper preserves the existing "missing `kind` defaults to `liveActivity`" behavior so externally-stored v1 payloads keep parsing.
  - Adds `liveSurfaceSnapshotV0`, `migrateV0ToV1`, and `safeParseAnyVersion` for promoting historical v0 payloads. `assertSnapshot` / `safeParseSnapshot` continue to validate strictly against v1 with no auto-migration.
  - Generated JSON Schema is now a `oneOf` of `const`-discriminated branches, and `$id` is pinned to `@1.0/schema.json` (major.minor) so future minors can ship a new schema URL without yanking the old one.
  - `schemaVersion` stays at `"1"` (fix-forward); existing fixtures and producers that already set `kind` and matching slices remain valid.

- 2de238f: Add `@mobile-surfaces/push`, the canonical Node SDK for sending Mobile Surfaces snapshots to APNs.

  - New package `@mobile-surfaces/push@0.1.0` ships `createPushClient` with `alert` / `update` / `start` / `end` / `broadcast` / `createChannel` / `listChannels` / `deleteChannel`. Drives the existing `LiveSurfaceSnapshot` projection helpers from `@mobile-surfaces/surface-contracts` at the wire layer.
  - Long-lived HTTP/2 session per `PushClient`, JWT cached with a 50-minute refresh window (10-minute safety buffer below Apple's 60-minute cap), retry policy with exponential backoff + jitter that honors `Retry-After` for 429s.
  - Full APNs error taxonomy (`BadDeviceTokenError`, `TooManyRequestsError`, `ChannelNotRegisteredError`, … 17 subclasses + `UnknownApnsError` fallback) plus `InvalidSnapshotError` and `ClientClosedError`. All carry `apnsId`, `status`, `reason`, `timestamp`.
  - Channel management routed to the documented split host/port: `api-manage-broadcast.sandbox.push.apple.com:2195` (development) and `api-manage-broadcast.push.apple.com:2196` (production).
  - Zero npm runtime deps — only the workspace `@mobile-surfaces/surface-contracts`. JWT signing is hand-rolled `node:crypto` ES256 (matching the proven `scripts/send-apns.mjs` implementation) for auditability.
  - `pnpm test:push` added to root, wired into CI and publish workflows.

  The new package is added to the linked release group so it versions in lockstep with the rest of `@mobile-surfaces/*` and `create-mobile-surfaces`.

### Patch Changes

- Updated dependencies [2de238f]
- Updated dependencies [2de238f]
  - @mobile-surfaces/surface-contracts@1.2.0

## 1.0.0

### Major Changes

- 0fd08f4: Make the contract package consumable from plain Node backends, generalize it for multi-surface projections, and tighten correctness across the board.

  - Build all three library packages to ESM `dist/` via tsup; drop raw `.ts` from `main`/`types`. JSON imports inlined at build, so consumers don't need Node 22+ import attributes. The `source` exports condition keeps Metro reading TS source for HMR.
  - Replace the anemic `schema.json` with Zod v4 as the single source of truth: ships `assertSnapshot` / `safeParseSnapshot` / `liveSurfaceSnapshot`, generates a real JSON Schema (`unpkg.com/@mobile-surfaces/surface-contracts@1/schema.json`), and bumps the public contract to `schemaVersion: "1"`.
  - Generalize `LiveSurfaceSnapshot` with a top-level `kind` discriminator, explicit `liveActivity` fixtures, optional widget/control/notification slices, and kind-gated projection helpers for Live Activity, widgets, controls, and notification content.
  - Add the first real multi-surface implementation: home-screen widget and iOS 18 control widget sharing projected snapshots through App Group storage, with harness buttons to refresh widget state and toggle control state.
  - CLI: include App Group entitlements in add-to-existing planning/patching and copy the expanded WidgetKit target files.
  - CI guards: structural Swift ↔ Zod drift detector for `MobileSurfacesActivityAttributes.swift`, fixture filename collision detection, linked changeset group so contract bumps force a CLI republish.
  - CLI: thread `appleTeamId` through the add-to-existing flow, rename `MobileSurfaces*` widget files to the user's identity in add-to-existing, fail-fast on missing pnpm / CocoaPods with a clear fix message, reject `com.example.*` placeholder bundle IDs at the prompt.
  - Scripts: APNs response reasons translated to causes + fixes, JWT clock-skew warning when local clock differs from APNs `Date` header by more than 5 minutes, rename script is now idempotent (`.mobile-surfaces-identity.json` manifest) and supports `--dry-run`.
  - Hygiene: `pnpm` is required (`only-allow pnpm` preinstall guard), CLI engines tightened to `>=24.0.0 <25`, `live-activity` peers pinned to the compatibility row (`expo>=54`, `react>=19`, `react-native>=0.81`), authors set on every package, CocoaPods podspec author/homepage corrected.
  - Harness: Live Activity "no" hint now diagnoses the cause (Expo Go vs iOS < 16.2 vs settings toggle) instead of a fixed copy.

### Patch Changes

- Updated dependencies [0fd08f4]
  - @mobile-surfaces/surface-contracts@1.0.0
