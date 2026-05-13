# Mobile Surfaces Docs

Mobile Surfaces is a starter and reference architecture for iOS Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets in Expo apps. If you are new to these Apple surfaces, start with the root [`README.md`](../README.md), then use the path below that matches your job.

## Reading Paths

Pick the persona that fits, read the three docs in order, then come back here for the full reference.

| Persona | I am building... | Read these three, in order |
| --- | --- | --- |
| **Backend integrator** | A service that emits snapshots and sends APNs pushes from Node, no mobile work | [`backend-integration.md`](./backend-integration.md) -> [`push.md`](./push.md) -> [`troubleshooting.md`](./troubleshooting.md) |
| **Mobile app developer** | An iPhone app on the starter, every surface wired up locally | [`../README.md`](../README.md) -> [`ios-environment.md`](./ios-environment.md) -> [`multi-surface.md`](./multi-surface.md) |
| **Foreign Expo integrator** | An existing Expo app that adopts Mobile Surfaces without forking the starter | [`../packages/create-mobile-surfaces/README.md`](../packages/create-mobile-surfaces/README.md) -> [`compatibility.md`](./compatibility.md) -> [`architecture.md`](./architecture.md) |
| **Contributor / maintainer** | A change to this repo, or a release of the linked packages | [`architecture.md`](./architecture.md) -> [`traps.md`](./traps.md) -> [`release.md`](./release.md) |
| **Triaging a silent failure** | A live bug where the Lock Screen is empty or APNs returns 200 with no effect | [`troubleshooting.md`](./troubleshooting.md) -> [`push.md`](./push.md) -> [`../AGENTS.md`](../AGENTS.md) |
| **Wiring production telemetry** | A backend already in production, need to know what to log and alert on | [`observability.md`](./observability.md) -> [`push.md`](./push.md) -> [`../AGENTS.md`](../AGENTS.md) |

## Glossary

- **ActivityKit**: Apple's framework for Live Activities. It owns the Lock Screen and Dynamic Island live-updating surfaces.
- **APNs**: Apple Push Notification service. Your backend sends HTTP/2 requests to APNs; APNs delivers alerts, Live Activity updates, starts, ends, and broadcasts to devices.
- **App Group**: A shared container entitlement that lets the host app and widget extension read the same data. If the App Group strings differ, widgets show placeholder data.
- **CNG / prebuild**: Continuous Native Generation. Expo regenerates `apps/mobile/ios/` from source config, so manual edits inside generated iOS files are not durable.
- **Dev client**: A custom Expo build that includes local native modules. Expo Go cannot run ActivityKit, WidgetKit, App Groups, or this local native module.
- **LiveSurfaceSnapshot**: The one JSON-like shape your app or backend emits. Every surface derives its render input or APNs payload from it.
- **Projection**: A pure helper that turns a `LiveSurfaceSnapshot` into the smaller shape a surface needs, such as ActivityKit `content-state` or a widget timeline entry.
- **`kind`**: The discriminator inside `LiveSurfaceSnapshot`. It tells the validator which branch is valid: `liveActivity`, `widget`, `control`, `notification`, `lockAccessory`, or `standby`.
- **Schema version**: The wire-format version inside snapshots (`schemaVersion: "2"` in v3.x; `"1"` in v2.x and earlier). This is separate from npm package versions like `1.2.0`.
- **Trusted publishing**: npm publishing through GitHub Actions OIDC. No npm token is stored in the repo.

## Full Reference

- [`architecture.md`](./architecture.md): contract-first model, native stack, adapter boundary, validation rules.
- [`multi-surface.md`](./multi-surface.md): every `kind` value, what ships today, when to emit each.
- [`backend-integration.md`](./backend-integration.md): domain event to `LiveSurfaceSnapshot` to APNs walkthrough.
- [`push.md`](./push.md): push SDK, token taxonomy, APNs hosts, error reasons, smoke scripts.
- [`observability.md`](./observability.md): which catalog-bound errors are worth alerting on, hook signatures, recommended log shape, stuck Live Activity detection.
- [`ios-environment.md`](./ios-environment.md): dev builds, App Groups, generated native folders, simulator/device loops.
- [`compatibility.md`](./compatibility.md): pinned Expo SDK, React Native, iOS, Xcode, and `@bacons/apple-targets` row.
- [`schema-migration.md`](./schema-migration.md): v1 to v2 codec, deprecation timeline, JSON Schema `$id`, future evolution policy.
- [`troubleshooting.md`](./troubleshooting.md): symptom-to-fix recipes for silent iOS failures.
- [`release.md`](./release.md): Changesets release PRs, npm trusted publishing, release verification.
- [`roadmap.md`](./roadmap.md): shipped work, deferred work, and frontier items.
- [`traps.md`](./traps.md): maintainer guide for the trap catalog that generates `AGENTS.md` and `CLAUDE.md`.
