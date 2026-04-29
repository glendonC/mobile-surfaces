# Mobile Surfaces

[![CI](https://github.com/glendonC/mobile-surfaces/actions/workflows/ci.yml/badge.svg)](https://github.com/glendonC/mobile-surfaces/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Opinionated Expo iOS starter for Live Activities and Dynamic Island workflows.

Mobile Surfaces gives developers the native iOS pieces of a multi-surface Expo app without first becoming ActivityKit, WidgetKit, or APNs experts. It includes a React Native harness, shared surface contracts, deterministic fixtures, a local ActivityKit bridge, a SwiftUI widget target, APNs smoke scripts, and local setup/doctor commands.

## Who This Is For

- Expo or React Native developers adding iOS Live Activities and Dynamic Island previews.
- Web or backend developers who need deterministic fixtures and push payload examples before wiring production services.
- Teams that want a contract-first boundary between product data and mobile surfaces.

## V0 Scope

- Expo / React Native with an Expo dev client, not Expo Go.
- iOS only.
- ActivityKit, WidgetKit, and Dynamic Island through a local Expo module plus `@bacons/apple-targets`.
- Shared `LiveSurfaceSnapshot` contract, design tokens, fixtures, validation scripts, and APNs smoke helpers.
- Opinionated defaults: local ActivityKit bridge, SwiftUI WidgetKit extension, JSON fixture source of truth, and generated TypeScript preview fixtures.

## Non-Goals

These are intentionally out of scope. PRs that add them will be redirected.

- Android.
- A SwiftUI-only starter (no Expo).
- A universal "add Mobile Surfaces to an existing repo" patcher.
- A production push service or backend integration.
- An MCP runtime.
- Multi-tenant theming, plugin systems, or any abstraction not justified by two real consumers in this repo.
- Replacing the local ActivityKit module with `expo-live-activity` or `expo-widgets` before v0 ships.
- Anchoring on `expo-widgets` while it is alpha.
- Tracking iOS bleeding edge (broadcast push, channel-based delivery) before v0 ships.

## Prerequisites

- macOS with Xcode 16 or newer (`xcodebuild -version`).
- An installed iOS 16.2+ simulator. Confirm with `xcrun simctl list devices available`. The default simulator is `iPhone 17 Pro`; override with `DEVICE="<name>"`.
- Node.js 24 (the repo's `engines` field). Use `nvm`, `fnm`, or Homebrew to install.
- pnpm 10.7+ (`corepack enable pnpm` is enough — the repo pins the exact version via `packageManager`).
- An Apple Developer account, but only when you reach APNs smoke tests or device builds. Simulator + harness flows do not require one.

See [`docs/compatibility.md`](./docs/compatibility.md) for the pinned toolchain row.

## Quick Start

```bash
pnpm dev:setup
pnpm dev:doctor
pnpm surface:check
pnpm typecheck
pnpm mobile:sim
```

`pnpm mobile:sim` builds an iOS development app. Live Activities and Dynamic Island testing require a dev build; Expo Go cannot load the local native module or widget extension.

When `pnpm mobile:sim` finishes, the simulator opens the dev-client app on the **Surface Harness** screen. You should see "Activities supported: yes" near the top, a row of generic Start buttons (`queued`, `active`, `paused`, `completed`, etc., one per fixture in `data/surface-fixtures/`), and empty "Current activity" and "All active activities" sections. Tap **queued** to start a Live Activity from `data/surface-fixtures/queued.json`: an activity id appears in "Current activity", the entry shows up in "All active activities" with progress and stage, and once iOS issues a push token it streams in asynchronously. The Update and End rows then operate on that activity.

The core dev workflow is contract-driven: start a generic surface state from the harness, preview Lock Screen and Dynamic Island layouts, update or end it locally, then smoke-test APNs payloads with the same contract.

## Rename For Your Project

The starter ships with the placeholder identity `Mobile Surfaces` / `mobilesurfaces` / `com.example.mobilesurfaces` / `MobileSurfacesWidget`. Run the rename script once after cloning to swap in your own:

```bash
pnpm surface:rename -- \
  --name "Your App" \
  --scheme yourapp \
  --bundle-id com.acme.yourapp \
  --widget-target YourAppWidget
```

The script rewrites `app.json`, the SwiftUI target sources, the local Live Activity module, fixture deep links, scripts, and docs in one pass, then renames the `MobileSurfaces*.swift` files to use your Swift prefix and reruns `surface:check`. Pass `--help` for the optional `--slug`, `--swift-prefix`, and `--app-package-name` overrides.

## Repo Map

- `apps/mobile/` - Expo app and Live Activity harness.
- `apps/mobile/modules/live-activity/` - local Expo module wrapping ActivityKit.
- `apps/mobile/targets/widget/` - SwiftUI WidgetKit target for Lock Screen and Dynamic Island.
- `packages/surface-contracts/` - `@mobile-surfaces/surface-contracts`, `LiveSurfaceSnapshot`, generated fixture exports, and mapping helpers.
- `packages/design-tokens/` - `@mobile-surfaces/design-tokens`, shared UI tokens for app and widget alignment.
- `data/surface-fixtures/` - deterministic JSON snapshots for previews and smoke tests.
- `scripts/` - setup, doctor, validation, simulator push, and APNs scripts.

## Recommended V0 Path

This repo keeps the current local ActivityKit module for v0 and uses `@bacons/apple-targets` to keep widget source outside generated `ios/`. `expo-live-activity` is a useful future adapter candidate. `expo-widgets` is promising, but it is still alpha and has active Live Activity rendering rough edges, so it is not the default path yet.

## Docs

- [`docs/architecture.md`](./docs/architecture.md) - contract-first architecture and implementation choice.
- [`docs/ios-environment.md`](./docs/ios-environment.md) - dev builds, simulator/device testing, APNs, and generated iOS policy.
- [`docs/compatibility.md`](./docs/compatibility.md) - pinned Expo SDK, React Native, iOS, Xcode, and `@bacons/apple-targets` versions.
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) - symptom-to-fix recipes for the most common dev-loop snags.
- [`docs/backend-integration.md`](./docs/backend-integration.md) - domain event → `LiveSurfaceSnapshot` → APNs walkthrough for backend developers.
- [`docs/roadmap.md`](./docs/roadmap.md) - v0 priorities and future `create-mobile-surfaces` CLI.