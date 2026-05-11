# Roadmap

Mobile Surfaces is an Expo iOS reference architecture for ActivityKit, WidgetKit, and APNs. The current effort is the 2026-04 architectural refactor; see `notes/refactor-2026-04.md` for the working ledger. This page summarizes what has shipped, what is in flight, what is deferred (and why), and the iOS 26 frontier.

## Shipped

### Phase 1: Modern toolchain floor

Pinned row, verified end-to-end:

- Expo SDK `~55.0.18`, React Native `0.83.6`, React `19.2.0`.
- iOS deployment target `17.2` (deliberately above SDK 55's 15.1 floor so push-to-start lands without `if #available` ceremony).
- Xcode 26 (`scripts/doctor.mjs` enforces the major). Swift 6.2 in toolchain.
- `@bacons/apple-targets` exact-pinned at `4.0.6`.

See [`compatibility.md`](./compatibility.md) for the canonical pinned row.

### Phase 2: Multi-projection contract

`LiveSurfaceSnapshot` is a true `z.discriminatedUnion("kind", […])` at `schemaVersion: "1"` with six members: `liveActivity`, `widget`, `control`, `lockAccessory`, `standby`, `notification`. Per-kind slices (`widget`, `control`, `notification`) are strict objects attached to their respective branches.

- The published JSON Schema is `oneOf` with `const`-discriminated branches, proper kind ↔ slice enforcement, not a loose union.
- A `.preprocess()` shim defaults missing-`kind` payloads to `"liveActivity"` so externally stored snapshots from before the discriminator still parse. Authored fixtures in this repo always set `kind` explicitly.
- Migration codec ships in `packages/surface-contracts`: `liveSurfaceSnapshotV0`, `migrateV0ToV1`, `safeParseAnyVersion`. See [`schema-migration.md`](./schema-migration.md).
- `$id` pins to `https://unpkg.com/@mobile-surfaces/surface-contracts@2.0/schema.json` (major.minor) so a future minor that adds a discriminated-union variant can publish a new URL without yanking what consumers reference.
- Standard Schema interop is live: Zod 4.x implements `~standard` (`{ vendor: "zod", version: 1, validate, jsonSchema }`) on every exported schema. A fixture-validation test pins this so it cannot regress.

### Phase 3: Home widget + iOS 18 control widget

- One WidgetKit extension under `apps/mobile/targets/widget/` hosts the Lock Screen Live Activity, the home-screen widget (`MobileSurfacesHomeWidget`, small/medium/large), and the iOS 18 control widget (`MobileSurfacesControlWidget`).
- Widget and control state flows through a shared App Group (`group.com.example.mobilesurfaces`) keyed on `surface.snapshot.<surfaceId>`, with `surface.widget.currentSurfaceId` / `surface.control.currentSurfaceId` pointing at the active entries.
- Harness wires "Refresh widget" and "Toggle control state" actions; fixtures for `kind: "widget"` and `kind: "control"` ship under `data/surface-fixtures/`.
- `_shared` AppIntent files give intents both app and extension target membership via `@bacons/apple-targets`.

Lock-screen accessory, notification content extension, and StandBy variants are intentionally not included in this slice; they are listed under In flight / Frontier below.

### Phase 4: Modern APNs

- `Activity<MobileSurfacesActivityAttributes>.pushToStartTokenUpdates` (iOS 17.2+) exposed via the `onPushToStartToken` event on `@mobile-surfaces/live-activity`. `getPushToStartToken()` exists for adapter-contract symmetry but always resolves `null` (Apple does not expose a synchronous query).
- Optional `channelId` argument on `start()` routes ActivityKit through `pushType: .channel(...)` for iOS 18+ broadcast push. iOS < 18 throws `ACTIVITY_UNSUPPORTED_FEATURE` rather than silently degrading.
- `scripts/send-apns.mjs` extended with `--push-to-start-token`, `--channel-id`, `--channel-action={create,list,delete}`, `--storage-policy`. Channel-management requests hit `api-manage-broadcast.{sandbox.,}push.apple.com:2195/2196` with the sandbox/prod split per Apple docs.
- APNs reason translator extended with `MissingChannelId`, `BadChannelId`, `ChannelNotRegistered`, `CannotCreateChannelConfig`, `InvalidPushType`, `FeatureNotEnabled`, `MissingPushType`, verified verbatim against current Apple docs.

### Phase 6: `@mobile-surfaces/push` Node SDK

`packages/push/` ships with the linked package release group:

- `PushClient` / `createPushClient(...)` with connection-pooled HTTP/2.
- Typed error hierarchy (per APNs reason); ES256 JWT cache; HTTP/2 reconnect; exponential-backoff retry policy.
- Mock-h2c test suite under `packages/push/test/`.
- Linked release group includes it (`.changeset/config.json`) so it always co-versions with `@mobile-surfaces/surface-contracts`, `@mobile-surfaces/design-tokens`, `@mobile-surfaces/live-activity`, and `create-mobile-surfaces`.

`scripts/send-apns.mjs` is intentionally NOT refactored to import from the SDK; it stays as a self-contained protocol-reference script that can be read top-to-bottom without indirection.

### CLI

`create-mobile-surfaces` ships both modes today:

- **Greenfield:** `npm create mobile-surfaces@latest` scaffolds a new starter, runs the user's package manager, and prints next steps for `mobile:prebuild:ios`.
- **Add-to-existing:** detects an Expo app and patches in packages, the WidgetKit target, App Group entitlements, the live-activity adapter, fixtures, scripts, and docs. Driven by `template/manifest.json` so the bundled dependency versions track the linked release group.

## In flight

### Phase 7: Docs + CLI updates

This roadmap rewrite is part of Phase 7. Shipped docs now cover the multi-surface contract and push SDK. Remaining work: CLI surface picks (home widget alone, control widget alone) for the add-to-existing flow, plus ongoing docs polish from install-path testing.

## Deferred (with reason)

### Phase 5: SPM-shared Swift

**Status: deferred upstream-blocked.** The byte-identical Swift duplication is still present today:

- `packages/live-activity/ios/MobileSurfacesActivityAttributes.swift`
- `apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift`

`scripts/check-activity-attributes.mjs` runs in `pnpm surface:check` to enforce byte-identity. Removing the duplication requires a local Swift Package consumed by both the Expo native module and the WidgetKit target, which needs:

- `@bacons/apple-targets` local-SPM-package configuration. PR #122 was closed; replacement PR #177 is open but unmerged. We are at exact-pin 4.0.6.
- React Native `spm_dependency` for local paths, which lands in RN 0.84. We are on 0.83.6.

Revisit when Expo SDK 56 ships. Until then, the duplication and the byte-identity guard stay in place.

### Lock-screen accessory, notification content extension, StandBy

The contract already accommodates `kind: "lockAccessory"`, `kind: "standby"`, and `kind: "notification"` (with projection helper `toNotificationContentPayload`), but the SwiftUI surfaces and harness wiring do not exist yet. Fixtures and renderers are out of scope until the Phase 3 home/control work has soak time on real devices.

## Frontier: iOS 26 (Phase 8)

Explicitly out of scope unless a real use case surfaces. Listed here so the option is visible, not as a commitment:

- ScheduledActivity scheduling API.
- AlarmKit countdown integration.
- Liquid Glass / `levelOfDetail` rendering hints.
- StandBy variant rendering hint.

## Out of scope

- Android. iOS-only by design.
- Expo Go. Dev client only.
- A universal patcher for arbitrary existing app layouts. The add-to-existing CLI targets recognizable Expo projects; truly bespoke layouts should clone the starter and adapt manually.
- An adapter abstraction layer that swaps to `software-mansion-labs/expo-live-activity` or `expo-widgets`. The adapter boundary at `apps/mobile/src/liveActivity/index.ts` is preserved (and enforced by `scripts/check-adapter-boundary.mjs`) so a future branch can experiment, but the local module remains the default starter path.
