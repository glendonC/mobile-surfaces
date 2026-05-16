# Mobile Surfaces

The wire format for iOS Live Activities, widgets, and controls. Bridge-agnostic, push-included, with every silent-failure mode enforced as a CI invariant.

[![CI](https://github.com/glendonC/mobile-surfaces/actions/workflows/ci.yml/badge.svg)](https://github.com/glendonC/mobile-surfaces/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## What this is

Mobile Surfaces is not a Live Activity bridge. It is the layer above the bridge that gives your app, your widget extension, your control widget, and your backend a single typed shape (`LiveSurfaceSnapshot`) to agree on. One `kind` discriminator picks one of six surfaces; one projection helper per surface turns the snapshot into the ActivityKit content state, the WidgetKit timeline entry, the Control Center value provider, or the APNs alert payload that surface needs.

Three pieces ship together:

- **`@mobile-surfaces/surface-contracts`** — typed `LiveSurfaceSnapshot` plus six projection helpers, a published JSON Schema, Standard Schema interop, and a v4 → v5 migration codec.
- **`@mobile-surfaces/push`** — Node APNs client. HTTP/2 connection pooling, JWT signing, push-to-start tokens, iOS 18 broadcast channels, typed errors for every documented APNs reason.
- **Trap catalog** — 40 documented iOS silent-failure modes ([`data/traps.json`](./data/traps.json)) enforced as CI invariants and rendered as [`AGENTS.md`](./AGENTS.md) and [`CLAUDE.md`](./CLAUDE.md). Static rules fail at PR time; runtime rules surface as typed errors.

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

## Install

**Already shipping Live Activities?** Drop the contract and push client in alongside `expo-live-activity`, a hand-rolled native module, or any other bridge:

```bash
pnpm add @mobile-surfaces/surface-contracts @mobile-surfaces/push
```

**Starting from zero?** Scaffold a working iPhone app with every surface wired up:

```bash
pnpm create mobile-surfaces
```

**Auditing an existing Expo project?** Run the trap catalog against it:

```bash
npx mobile-surfaces audit ./path/to/project
```

See [the docs](https://mobile-surfaces.com/docs) for the full reading paths.

## Why this exists

iOS Live Activities silently fail. Your code compiles, your push returns HTTP 200, the app runs, and nothing shows up on the Lock Screen. There is no error message and no log to tell you what went wrong. The cause is one of a dozen iOS-specific traps that Apple's documentation barely mentions:

- Push tokens minted by your dev build cannot talk to Apple's production server, but the failure looks like a generic 400.
- Two Swift files in different folders have to be byte-identical or your activity silently never appears.
- The app and the widget share state through an App Group identifier. If the two sides do not match exactly, the widget reads placeholder data forever.
- Apple aggressively rate-limits high-priority Live Activity pushes; sustained sends get silently dropped.
- The generated `ios/` directory rebuilds on every prebuild, so manual fixes in Xcode get wiped.

Add a home-screen widget, an iOS 18 Control Center button, and a backend driving all of it through APNs, and the surface area for silent failure roughly doubles.

We are not better than [`expo-live-activity`](https://github.com/software-mansion-labs/expo-live-activity). We are the layer above any iOS bridge: the contract that keeps your snapshot shape consistent across surfaces, the push client that drives the wire correctly, and the catalog of failure modes so they break at CI instead of on a customer device. See [Mobile Surfaces with expo-live-activity](https://mobile-surfaces.com/docs/vs-expo-live-activity) for the side-by-side.

## Links

- [Docs hub](https://mobile-surfaces.com/docs)
- [`AGENTS.md`](./AGENTS.md) — invariants for AI coding assistants (also published as [`CLAUDE.md`](./CLAUDE.md))
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [LICENSE](./LICENSE) — MIT
