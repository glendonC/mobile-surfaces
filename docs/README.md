# Mobile Surfaces Docs

Mobile Surfaces is an opinionated Expo iOS starter for Live Activities and Dynamic Island workflows. Start with:

- [`architecture.md`](./architecture.md) for the contract-first model and v0 implementation choice.
- [`ios-environment.md`](./ios-environment.md) for dev builds, APNs, simulator/device testing, and generated native folders.
- [`compatibility.md`](./compatibility.md) for the pinned Expo SDK / React Native / iOS / Xcode / `@bacons/apple-targets` row.
- [`troubleshooting.md`](./troubleshooting.md) for symptom-to-fix recipes (Activities supported: no, Lock Screen empty, APNs 403/400, stale Metro/Watchman).
- [`backend-integration.md`](./backend-integration.md) for the domain event → `LiveSurfaceSnapshot` → APNs walkthrough, including remote `event: "start"` and the three token kinds.
- [`schema-migration.md`](./schema-migration.md) for v0 → v1 promotion, the missing-`kind` shim, JSON Schema `$id` pinning, future evolution policy, and Standard Schema interop.
- [`release.md`](./release.md) for npm trusted publishing and release verification.
- [`roadmap.md`](./roadmap.md) for what has shipped, what is in flight, what is deferred (with reason), and the iOS 26 frontier.
