# Mobile Surfaces Docs

Mobile Surfaces is a starter and reference architecture for iOS Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets in Expo apps. If you are new to these Apple surfaces, start with the root [`README.md`](../README.md), then use the path below that matches your job.

## Start Here If...

| If you want to... | Read these first |
| --- | --- |
| Try the starter app | [`README.md`](../README.md), [`ios-environment.md`](./ios-environment.md), [`troubleshooting.md`](./troubleshooting.md) |
| Add Mobile Surfaces to an existing Expo app | [`packages/create-mobile-surfaces/README.md`](../packages/create-mobile-surfaces/README.md), [`architecture.md`](./architecture.md), [`compatibility.md`](./compatibility.md) |
| Write a backend integration | [`backend-integration.md`](./backend-integration.md), [`push.md`](./push.md), [`packages/surface-contracts/README.md`](../packages/surface-contracts/README.md) |
| Understand every surface and `kind` value | [`multi-surface.md`](./multi-surface.md), [`schema-migration.md`](./schema-migration.md), [`architecture.md`](./architecture.md) |
| Debug a silent failure | [`troubleshooting.md`](./troubleshooting.md), [`push.md`](./push.md), [`AGENTS.md`](../AGENTS.md) |
| Maintain or release the repo | [`release.md`](./release.md), [`roadmap.md`](./roadmap.md), [`traps.md`](./traps.md) |

## Glossary

- **ActivityKit**: Apple's framework for Live Activities. It owns the Lock Screen and Dynamic Island live-updating surfaces.
- **APNs**: Apple Push Notification service. Your backend sends HTTP/2 requests to APNs; APNs delivers alerts, Live Activity updates, starts, ends, and broadcasts to devices.
- **App Group**: A shared container entitlement that lets the host app and widget extension read the same data. If the App Group strings differ, widgets show placeholder data.
- **CNG / prebuild**: Continuous Native Generation. Expo regenerates `apps/mobile/ios/` from source config, so manual edits inside generated iOS files are not durable.
- **Dev client**: A custom Expo build that includes local native modules. Expo Go cannot run ActivityKit, WidgetKit, App Groups, or this local native module.
- **LiveSurfaceSnapshot**: The one JSON-like shape your app or backend emits. Every surface derives its render input or APNs payload from it.
- **Projection**: A pure helper that turns a `LiveSurfaceSnapshot` into the smaller shape a surface needs, such as ActivityKit `content-state` or a widget timeline entry.
- **`kind`**: The discriminator inside `LiveSurfaceSnapshot`. It tells the validator which branch is valid: `liveActivity`, `widget`, `control`, `notification`, `lockAccessory`, or `standby`.
- **Schema version**: The wire-format version inside snapshots (`schemaVersion: "1"`). This is separate from npm package versions like `1.2.0`.
- **Trusted publishing**: npm publishing through GitHub Actions OIDC. No npm token is stored in the repo.

## Full Reference

- [`architecture.md`](./architecture.md): contract-first model, native stack, adapter boundary, validation rules.
- [`multi-surface.md`](./multi-surface.md): every `kind` value, what ships today, when to emit each.
- [`backend-integration.md`](./backend-integration.md): domain event to `LiveSurfaceSnapshot` to APNs walkthrough.
- [`push.md`](./push.md): push SDK, token taxonomy, APNs hosts, error reasons, smoke scripts.
- [`ios-environment.md`](./ios-environment.md): dev builds, App Groups, generated native folders, simulator/device loops.
- [`compatibility.md`](./compatibility.md): pinned Expo SDK, React Native, iOS, Xcode, and `@bacons/apple-targets` row.
- [`schema-migration.md`](./schema-migration.md): schema v0 to v1 promotion, missing-`kind` shim, JSON Schema `$id`, future evolution policy.
- [`troubleshooting.md`](./troubleshooting.md): symptom-to-fix recipes for silent iOS failures.
- [`release.md`](./release.md): Changesets release PRs, npm trusted publishing, release verification.
- [`roadmap.md`](./roadmap.md): shipped work, deferred work, and frontier items.
- [`traps.md`](./traps.md): maintainer guide for the trap catalog that generates `AGENTS.md` and `CLAUDE.md`.
