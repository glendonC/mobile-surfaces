# Mobile Surfaces Docs

Mobile Surfaces is an opinionated Expo iOS starter for Live Activities and Dynamic Island workflows. Start with:

- [`architecture.md`](./architecture.md) for the contract-first model and v0 implementation choice.
- [`ios-environment.md`](./ios-environment.md) for dev builds, APNs, simulator/device testing, and generated native folders.
- [`compatibility.md`](./compatibility.md) for the pinned Expo SDK / React Native / iOS / Xcode / `@bacons/apple-targets` row.
- [`troubleshooting.md`](./troubleshooting.md) for symptom-to-fix recipes (Activities supported: no, Lock Screen empty, APNs 403/400, stale Metro/Watchman).
- [`backend-integration.md`](./backend-integration.md) for the domain event → `LiveSurfaceSnapshot` → APNs walkthrough, including remote `event: "start"` and the three token kinds.
- [`roadmap.md`](./roadmap.md) for the future `create-mobile-surfaces` CLI and post-v0 add-to-existing-repo direction.
