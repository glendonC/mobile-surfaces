# Mobile Surfaces Docs

Mobile Surfaces is a starter and reference architecture for iOS Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets in Expo apps. Start with:

- [`architecture.md`](./architecture.md) for the contract-first model and v0 implementation choice.
- [`ios-environment.md`](./ios-environment.md) for dev builds, APNs, simulator/device testing, and generated native folders.
- [`compatibility.md`](./compatibility.md) for the pinned Expo SDK / React Native / iOS / Xcode / `@bacons/apple-targets` row.
- [`troubleshooting.md`](./troubleshooting.md) for symptom-to-fix recipes (Activities supported: no, Lock Screen empty, APNs 403/400, stale Metro/Watchman).
- [`backend-integration.md`](./backend-integration.md) for the domain event → `LiveSurfaceSnapshot` → APNs walkthrough, including remote `event: "start"` and the three token kinds.
- [`schema-migration.md`](./schema-migration.md) for v0 → v1 promotion, the missing-`kind` shim, JSON Schema `$id` pinning, future evolution policy, and Standard Schema interop.
- [`traps.md`](./traps.md) for the trap catalog schema and the workflow for adding/editing rules consumed by `AGENTS.md`, `CLAUDE.md`, and the future `mobile-surfaces check` CLI.
- [`release.md`](./release.md) for npm trusted publishing and release verification.
- [`roadmap.md`](./roadmap.md) for what has shipped, what is in flight, what is deferred (with reason), and the iOS 26 frontier.
