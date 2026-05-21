# Mobile Surfaces

The wire format for iOS Live Activities, widgets, and controls. Bridge-agnostic, push-included, with every silent-failure mode enforced as a CI invariant.

[![CI](https://github.com/glendonC/mobile-surfaces/actions/workflows/ci.yml/badge.svg)](https://github.com/glendonC/mobile-surfaces/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## What this is

Mobile Surfaces is not a Live Activity bridge. It is the layer above the bridge that gives your app, your widget extension, your control widget, and your backend a single typed shape (`LiveSurfaceSnapshot`) to agree on. One `kind` discriminator picks one of six surfaces; one projection helper per surface turns the snapshot into the ActivityKit content state, the WidgetKit timeline entry, the Control Center value provider, or the APNs alert payload that surface needs.

Three pieces ship together:

- **`@mobile-surfaces/surface-contracts`**: typed `LiveSurfaceSnapshot` plus six projection helpers, a published JSON Schema, and Standard Schema interop.
- **`@mobile-surfaces/push`**: Node APNs client. HTTP/2 connection pooling, JWT signing, push-to-start tokens, iOS 18 broadcast channels, typed errors for every documented APNs reason.
- **Trap catalog**: <!-- catalog-stats:live -->40<!-- /catalog-stats:live --> documented iOS silent-failure modes ([`data/traps.json`](./data/traps.json)), rendered as [`AGENTS.md`](./AGENTS.md) and [`CLAUDE.md`](./CLAUDE.md). <!-- catalog-stats:prGated -->23<!-- /catalog-stats:prGated --> are enforced at PR time by `pnpm surface:check`; the rest surface as typed runtime errors or advisory notes.

Mobile Surfaces is a single-maintainer reference architecture. The trap catalog and push client reflect failure modes encountered building the reference app, not a survey of every production deployment. Treat it as a worked example to read and adapt, not a turnkey dependency with a support contract.

```ts
import { assertSnapshot, toLiveActivityContentState } from "@mobile-surfaces/surface-contracts";

const snapshot = assertSnapshot({
  schemaVersion: "5",
  kind: "liveActivity",
  id: `order-${order.id}`,
  surfaceId: `order-${order.id}`,
  updatedAt: new Date().toISOString(),
  state: "active",
  liveActivity: { title: "Order #1234", body: "Out for delivery", progress: 0.66, /* ... */ },
});
await pushClient.update(activityToken, snapshot);
```

## Who this is for

An Expo iOS team shipping a multi-surface product — a Live Activity, the Dynamic Island, home-screen and Lock Screen widgets, a Control Center control — backed by a Node service. Stay on `expo-live-activity` or any other ActivityKit bridge: Mobile Surfaces is the typed contract and the push-side layer above whichever bridge you use, not a replacement for it. If you ship a single surface with no backend, the contract is more structure than the job needs.

## Install

Three install paths depending on where you are starting from.

### Already shipping Live Activities

Drop the contract and push client in alongside `expo-live-activity`, a hand-rolled native module, or any other bridge:

```bash
pnpm add @mobile-surfaces/surface-contracts @mobile-surfaces/push
```

### Starting from zero

Scaffold a working iPhone app with every surface set up end to end:

```bash
pnpm create mobile-surfaces
```

### Auditing an existing Expo project

The trap catalog runs from inside a Mobile Surfaces checkout. Clone this repo, install once, and point the audit at your project:

```bash
pnpm surface:audit --root ./path/to/project
```

Add `--json` to wire the report into CI.

See [the docs](https://mobile-surfaces.com/docs) for the full reading paths.

## Why this exists

iOS Live Activities silently fail. Your code compiles, your push returns HTTP 200, the app runs, and nothing shows up on the Lock Screen. There is no error message and no log to tell you what went wrong. The cause is one of a dozen iOS-specific traps that Apple's documentation barely mentions:

- Push tokens minted by your dev build cannot talk to Apple's production server, but the failure looks like a generic 400.
- Two Swift files in different folders have to be byte-identical or your activity silently never appears.
- The app and the widget share state through an App Group identifier. If the two sides do not match exactly, the widget reads placeholder data forever.
- Apple aggressively rate-limits high-priority Live Activity pushes; sustained sends get silently dropped.
- The generated `ios/` directory rebuilds on every prebuild, so manual fixes in Xcode get wiped.

Add a home-screen widget, an iOS 18 Control Center button, and a backend driving all of it through APNs, and the surface area for silent failure roughly doubles.

Mobile Surfaces is not a replacement for [`expo-live-activity`](https://github.com/software-mansion-labs/expo-live-activity) or any other ActivityKit bridge. It sits above whichever bridge you use. The contract keeps your snapshot shape consistent across surfaces. The push client drives the wire correctly. The trap catalog turns ActivityKit's silent-failure modes into CI errors so they break at PR time, not on a customer device. See [Mobile Surfaces with expo-live-activity](https://mobile-surfaces.com/docs/vs-expo-live-activity) for the side-by-side.

## Links

- [Docs hub](https://mobile-surfaces.com/docs)
- [`AGENTS.md`](./AGENTS.md): invariants for AI coding assistants (also published as [`CLAUDE.md`](./CLAUDE.md))
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [LICENSE](./LICENSE): MIT
