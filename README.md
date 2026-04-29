# Mobile Surfaces

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

Out of scope for v0: Android, a SwiftUI-only starter, arbitrary backend integrations, a production push service, a universal add-to-existing-repo patcher, and an MCP runtime.

## Quick Start

```bash
pnpm dev:setup
pnpm dev:doctor
pnpm surface:check
pnpm typecheck
pnpm mobile:sim
```

`pnpm mobile:sim` builds an iOS development app. Live Activities and Dynamic Island testing require a dev build; Expo Go cannot load the local native module or widget extension.

The core dev workflow is contract-driven: start a generic surface state from the harness, preview Lock Screen and Dynamic Island layouts, update or end it locally, then smoke-test APNs payloads with the same contract.

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
- [`docs/roadmap.md`](./docs/roadmap.md) - v0 priorities and future `create-mobile-surfaces` CLI.