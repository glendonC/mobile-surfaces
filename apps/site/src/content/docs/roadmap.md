---
title: "Roadmap"
description: "Shipped work, deferred work, and frontier items."
order: 120
group: "Reference"
---
# Roadmap

Mobile Surfaces is an Expo iOS reference architecture for ActivityKit, WidgetKit, and APNs. The current effort is the 2026-04 architectural refactor; see `notes/refactor-2026-04.md` for the working ledger. This page summarizes what has shipped, what is in flight, what is deferred (and why), and the iOS 26 frontier.

## Shipped

### Phase 1: Modern toolchain floor

Pinned row, verified end-to-end:

- Expo SDK `~55.0.18`, React Native `0.83.6`, React `19.2.0`.
- iOS deployment target `17.2` (deliberately above SDK 55's 15.1 floor so push-to-start lands without `if #available` ceremony).
- Xcode 26 (`scripts/doctor.mjs` enforces the major). Swift 6.2 in toolchain.
- `@bacons/apple-targets` exact-pinned at `4.0.6`.

See [`compatibility.md`](/docs/compatibility) for the canonical pinned row.

### Phase 2: Multi-projection contract

`LiveSurfaceSnapshot` is a true `z.discriminatedUnion("kind", […])` with six members: `liveActivity`, `widget`, `control`, `lockAccessory`, `standby`, `notification`. Per-kind slices (`liveActivity`, `widget`, `control`, `notification`, `lockAccessory`, `standby`) are strict objects attached to their respective branches.

- The published JSON Schema is `oneOf` with `const`-discriminated branches, proper kind ↔ slice enforcement, not a loose union.
- Migration codec ships in `packages/surface-contracts`. Through 4.x: `liveSurfaceSnapshotV2`, `migrateV2ToV3`, `safeParseAnyVersion` chained v2 -> v3. From 5.0 forward: `liveSurfaceSnapshotV3`, `migrateV3ToV4`, `safeParseAnyVersion` chains v3 -> v4; the v2 codec is retired. See [`schema-migration.md`](/docs/schema-migration).
- `$id` pins to `https://unpkg.com/@mobile-surfaces/surface-contracts@<major.minor>/schema.json` so a future minor that adds a discriminated-union variant can publish a new URL without yanking what consumers reference. The current URL is `@6.0/schema.json`; `@5.0`, `@4.0`, `@3.2`, `@3.0` etc. stay resolvable on unpkg.
- Standard Schema interop is live: Zod 4.x implements `~standard` (`{ vendor: "zod", version: 1, validate, jsonSchema }`) on every exported schema. A fixture-validation test pins this so it cannot regress.

### Phase 3: Home widget + iOS 18 control widget

- One WidgetKit extension under `apps/mobile/targets/widget/` hosts the Lock Screen Live Activity, the home-screen widget (`MobileSurfacesHomeWidget`, small/medium/large), and the iOS 18 control widget (`MobileSurfacesControlWidget`).
- Widget and control state flows through a shared App Group (`group.com.example.mobilesurfaces`) keyed on `surface.snapshot.<surfaceId>`, with `surface.widget.currentSurfaceId` / `surface.control.currentSurfaceId` pointing at the active entries.
- Harness wires "Refresh widget" and "Toggle control state" actions; fixtures for `kind: "widget"` and `kind: "control"` ship under `data/surface-fixtures/`.
- `_shared` AppIntent files give intents both app and extension target membership via `@bacons/apple-targets`.

Lock-screen accessory and StandBy variants landed alongside the home and control widgets — see the per-`kind` status sections in [`docs/multi-surface.md`](/docs/multi-surface).

The notification content extension ships in this same slice at v6: `apps/mobile/targets/notification-content/MobileSurfacesNotificationViewController.swift` renders custom expanded content for category-routed notifications. Categories are codegened from `packages/surface-contracts/src/notificationCategories.ts` into the TS host registration, the Swift constant, and the extension's `Info.plist UNNotificationExtensionCategory` array (trapId MS037). The schema constrains `notification.category` to the same registry via `z.enum`, so a fixture cannot ship a category the host has not registered.

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
- Linked release group includes it (`.changeset/config.json`) so it always co-versions with `@mobile-surfaces/surface-contracts`, `@mobile-surfaces/live-activity`, and `create-mobile-surfaces`.

`scripts/send-apns.mjs` is intentionally NOT refactored to import from the SDK; it stays as a self-contained protocol-reference script that can be read top-to-bottom without indirection.

### v2 schema (3.0.0 release)

Reshape that addressed the four audit findings v1 could not patch:

- `stage`, `estimatedSeconds`, and `morePartsCount` moved out of the base shape into a new `liveActivity` slice. Other kinds stop carrying liveActivity-only values.
- `updatedAt` promoted from optional to required so consumers can drop out-of-order pushes.
- `liveSurfaceAlertPayload` and `toAlertPayload` moved to `@mobile-surfaces/push` and renamed `liveActivityAlertPayload` / `liveActivityAlertPayloadFromSnapshot` (the latter further renamed to `toApnsAlertPayload` at 5.0 for naming consistency with the other `to*` projection helpers; the wire shape did not change). The `aps` envelope is APNs wire format and belongs next to the SDK that sends it.
- v0 codec dropped (it was reconstructed from an internal commit and never consumed externally). The missing-`kind` preprocess removed alongside it; v2 producers must set `kind` explicitly.

The v1->v2 migration codec lives for the entire 3.x release line and is removed in 4.0.0. See [`schema-migration.md`](/docs/schema-migration) for the deprecation timeline and worked examples.

### v4 schema (5.0.0 release)

Finished the slice-per-kind transition that v2 started:

- Base shape collapsed to identity + lifecycle only (`id`, `surfaceId`, `kind`, `updatedAt`, `state`). Every rendering field (title/body, modeLabel, contextLabel, statusLine, progress, deepLink, actionLabel) moved into the per-kind slice that uses it, so each surface declares exactly what it renders and no kind carries fields meant for another.
- Notification slice renamed `primaryText`/`secondaryText` to `title`/`body`, matching the APNs `aps.alert.{title,body}` shape it projects into.
- Control slice gained a required `label` field (v3 had been falling back through `actionLabel` -> `primaryText`).
- v2 codec retired at the 5.0 cutover per the v3 RFC commitment; `safeParseAnyVersion` now chains v3 -> v4.

The v3->v4 migration codec lives for the entire 5.x release line and is removed in 6.0.0. See [`schema-migration.md`](/docs/schema-migration) for the codec timeline and the per-kind field-mapping table.

### CLI

`create-mobile-surfaces` ships both modes today:

- **Greenfield:** `npm create mobile-surfaces@latest` scaffolds a new starter, runs the user's package manager, and prints next steps for `mobile:prebuild:ios`.
- **Add-to-existing:** detects an Expo app and patches in packages, the WidgetKit target, App Group entitlements, the live-activity adapter, fixtures, scripts, and docs. Driven by `template/manifest.json` so the bundled dependency versions track the linked release group.

## In flight

### Phase 7: Docs + CLI updates

This roadmap rewrite is part of Phase 7. Shipped docs now cover the multi-surface contract and push SDK. Remaining work: CLI surface picks (home widget alone, control widget alone) for the add-to-existing flow, plus ongoing docs polish from install-path testing.

## Deferred (with reason)

### Phase 5: SPM-shared Swift

**Status: deferred upstream-blocked, mitigated by codegen.** The Swift duplication is still present:

- `packages/live-activity/ios/MobileSurfacesActivityAttributes.swift`
- `apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift`

Both files are now generated from `liveSurfaceActivityContentState` and `liveSurfaceStage` in `packages/surface-contracts/src/schema.ts` via `scripts/generate-activity-attributes.mjs`. `surface:check` gates codegen drift at stage 2 and byte-identity + Zod parity at stage 3. There is one source of truth (the Zod schema) and two files derived from it, so the previous "edit one and copy verbatim" workflow is gone. Removing the duplication entirely still requires a local Swift Package consumed by both the Expo native module and the WidgetKit target, which needs:

- `@bacons/apple-targets` local-SPM-package configuration. PR #122 was closed; replacement PR #177 is open but unmerged. We are at exact-pin 4.0.6.
- React Native `spm_dependency` for local paths, which lands in RN 0.84. We are on 0.83.6.

Revisit when Expo SDK 56 ships. The codegen path is deletable in one commit when SPM lands — the script goes, the Swift files become one file in the shared package, and the byte-identity check retires with them.

### Notification service extension

The notification surface ships `kind: "notification"`, the `toNotificationContentPayload` projection helper, the `client.sendNotification` SDK method, and a bundled `UNNotificationContentExtension` (`apps/mobile/targets/notification-content/`) that renders custom expanded content for category-routed notifications. What is intentionally not in the starter is the `UNNotificationServiceExtension` (a separate Apple extension type, `com.apple.usernotifications.service`) that intercepts a push before delivery to enrich its content. The service extension is the canonical Apple path when enrichment cannot fit in the 4 KB alert payload (image attachments, on-device personalization, E2E-decrypted content). Adding it later is purely additive: a sibling `apps/mobile/targets/notification-service/` directory, a `mutable-content: 1` flag on the wire, and an App-Group write path the content extension can read. The bundled content extension is already structured to fall back to payload-only rendering when no enrichment record exists, so the service extension can land independently without changing existing call sites.

### v6 schema features deferred

Two notification-surface features were deliberately deferred at the v5 cutover:

- **Attachments** (`UNNotificationAttachment`). Image, video, or audio enrichment served via URL or App Group file. Requires a `UNNotificationServiceExtension` to fetch and attach. The slice is shaped to extend non-breakingly when the time comes.
- **Localized strings** (`aps.alert.title-loc-key`, `loc-args`, etc.). Changes the projection-output shape (the `aps.alert` block becomes a union of plain vs localized variants), so we are holding it for a deliberate RFC rather than bolting on optional keys.

Lock-screen accessory and StandBy were originally deferred alongside the notification content extension and shipped earlier: `kind: "lockAccessory"` projects via `toLockAccessoryEntry`, `kind: "standby"` via `toStandbyEntry`. See the per-`kind` status sections in [`docs/multi-surface.md`](/docs/multi-surface).

## Frontier: iOS 26 (Phase 8)

Explicitly out of scope unless a real use case surfaces. Listed here so the option is visible, not as a commitment:

- ScheduledActivity scheduling API.
- AlarmKit countdown integration.
- Liquid Glass / `levelOfDetail` rendering hints.

## Out of scope

- Android. iOS-only by design.
- Expo Go. Dev client only.
- A universal patcher for arbitrary existing app layouts. The add-to-existing CLI targets recognizable Expo projects; truly bespoke layouts should clone the starter and adapt manually.
- An adapter abstraction layer that swaps to `software-mansion-labs/expo-live-activity` or `expo-widgets`. The adapter boundary at `apps/mobile/src/liveActivity/index.ts` is preserved (and enforced by `scripts/check-adapter-boundary.mjs`) so a future branch can experiment, but the local module remains the default starter path.
