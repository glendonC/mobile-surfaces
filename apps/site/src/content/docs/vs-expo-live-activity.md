---
title: "Mobile Surfaces and expo-live-activity"
description: "Cooperative positioning: what each project owns, when to use both, and the decision matrix."
order: 200
group: "Compare"
---
# Mobile Surfaces and `expo-live-activity`

[`expo-live-activity`](https://github.com/software-mansion-labs/expo-live-activity) is the established Expo bridge for iOS Live Activities, maintained by Software Mansion. It is a focused, well-engineered native module: start, update, end an Activity from JavaScript, expose push tokens, render Dynamic Island. If you only need Lock Screen and Dynamic Island and you have a backend already, it is the right choice.

Mobile Surfaces is not a competitor. It is the layer above any iOS bridge — the wire format, the push client, the catalog of silent-failure modes that turn ActivityKit code into a debugging-session generator. The two projects own different parts of the stack, and the install path explicitly supports running both at once.

## What each project owns

| Concern | `expo-live-activity` | `@mobile-surfaces/surface-contracts` | `@mobile-surfaces/push` | `@mobile-surfaces/traps` (catalog) |
| --- | --- | --- | --- | --- |
| iOS bridge: `Activity.request`, `Activity.update`, `Activity.end` | yes | — | — | — |
| Dynamic Island layouts (compact, minimal, expanded) | yes | — | — | — |
| `relevanceScore`, `staleDate`, small images, ActivityKit knobs | yes (broad surface) | typed-through where present | typed-through where present | catalogs the failure modes |
| Push tokens (per-activity, push-to-start) | yes (subscriptions) | — | accepts the tokens at the wire layer | catalogs token-lifecycle rules (MS016, MS020, MS021, MS023) |
| Wire contract for the snapshot shape | — | yes (`LiveSurfaceSnapshot`) | uses the contract | — |
| Home-screen widget, control widget, lock accessory, StandBy | — | yes (one snapshot, six projections) | drives the alert that triggers the host write | catalogs widget App Group rules (MS013, MS025, MS036) |
| Notification surface (alert, content extension, category routing) | — | yes | yes (`client.sendNotification`) | catalogs notification rules (MS037) |
| Node APNs SDK (JWT signing, HTTP/2 pooling, error taxonomy, retry, broadcast channels) | — | — | yes | catalogs APNs reason rules (MS011, MS014, MS018, MS028, MS030, MS031, MS032, MS034, MS035) |
| Catalog of silent-failure modes (40 invariants, enforced in CI) | — | — | — | yes |
| AI-coding-assistant grounding artifact (`AGENTS.md`, `CLAUDE.md`) | — | — | — | yes |
| Audit subcommand for foreign projects (`mobile-surfaces audit`) | — | — | — | uses the catalog |

The diagonal is the point. `expo-live-activity` is the iOS bridge. Mobile Surfaces is everything that surrounds the bridge: the contract that types the wire shape, the push SDK that drives it, and the catalog that catches the failures the bridge can't see.

## Install alongside `expo-live-activity`

```bash
pnpm add expo-live-activity @mobile-surfaces/surface-contracts @mobile-surfaces/push
```

Neither Mobile Surfaces package imports `expo-live-activity`; neither cares which ActivityKit bridge you use. Project domain data through the contract, hand the projection to whichever bridge you ship, drive the push side from Node.

```ts
import { useLiveActivity } from "expo-live-activity";
import {
  assertSnapshot,
  toLiveActivityContentState,
} from "@mobile-surfaces/surface-contracts";
import { createPushClient } from "@mobile-surfaces/push";

function FromYourScreen({ job }: { job: Job }) {
  const activity = useLiveActivity();

  async function start() {
    const snapshot = assertSnapshot(snapshotFromJob(job));
    const contentState = toLiveActivityContentState(snapshot);
    // expo-live-activity owns the bridge. Mobile Surfaces owns the typed
    // wire shape it consumes.
    await activity.start({
      attributes: { surfaceId: snapshot.surfaceId, modeLabel: "active" },
      contentState,
    });
  }
}

// Backend, separately:
const push = createPushClient({ /* APNS_* env vars */ });
await push.update(activityToken, snapshot);
```

## Why use both

Three reasons.

**1. Type safety across the wire.** `expo-live-activity` accepts whatever shape your `ContentState` Swift struct declares. The bridge has no way to know that a backend in another repo is emitting the wrong key. The contract closes that loop: one Zod schema, one TypeScript type, one published JSON Schema, one Swift struct that's enforced byte-identical against the contract (MS003). Backend, app, and widget extension all see the same shape, and CI fails the moment they drift.

**2. The wire layer is half the work.** A production APNs client is ES256 JWT signing with a 60-minute key rotation, HTTP/2 session pooling with reconnect, retry policy that respects priority budgets (priority 10 sends are silently throttled past Apple's quota), typed errors for the 20+ reason codes Apple returns, and channel management for iOS 18 broadcast push. `@mobile-surfaces/push` is that work, done once, with a test suite. The bridge hands you a token; the push client is the next eight weeks of backend code you don't have to write.

**3. The catalog catches what the bridge can't see.** 40 invariants in `data/traps.json` enumerate every silent-failure mode iOS has: App Group identity mismatches that render placeholder forever, push tokens from the wrong environment that fail with 400 BadDeviceToken, the `.push-type.liveactivity` topic suffix that has to be appended exactly once, the iOS 18 broadcast capability that's invisible until the first send fails. 29 of those rules are statically enforced by scripts in `surface:check`. Drop the catalog into any Expo project via `npx mobile-surfaces audit .` and the silent failures surface at PR time instead of on a customer device.

## What you give up by choosing the Mobile Surfaces bridge

The Mobile Surfaces repo ships its own ActivityKit bridge as `@mobile-surfaces/live-activity`. It is narrower than `expo-live-activity`:

- Smaller ActivityKit knob surface. `expo-live-activity` exposes `relevanceScore`, custom small images, compact-trailing fallbacks, and other ActivityKit options that the Mobile Surfaces bridge has not yet absorbed.
- Fewer shipped apps and contributors behind it. The Mobile Surfaces bridge is newer; `expo-live-activity` has more production miles.
- Tighter coupling to the Mobile Surfaces contract. The bridge is designed to consume `LiveSurfaceSnapshot` projections directly, which is opinionated; the broader Expo ecosystem treats `expo-live-activity` as the default.

The contract and push client are bridge-agnostic; the bridge in this repo is not the value proposition. If `expo-live-activity` already works for you, keep it. The two install paths converge on the wire format, not on which Swift module emits the `Activity.request`.

## Decision matrix

| Your situation | Recommended setup |
| --- | --- |
| Single-surface Lock Screen + Dynamic Island, backend already solved | `expo-live-activity` alone. Mobile Surfaces would be unnecessary weight. |
| Single-surface, need wider ActivityKit knob surface (`relevanceScore`, custom small images) | `expo-live-activity` alone. The Mobile Surfaces bridge has not absorbed those knobs yet. |
| Multiple surfaces (widget + control + Live Activity) sharing one data shape | `expo-live-activity` + `@mobile-surfaces/surface-contracts`. The contract is the only shape your domain emits; every surface projects from it. |
| Multiple surfaces and you also build the backend | Add `@mobile-surfaces/push`. The Node SDK saves the wire-layer work and types the error taxonomy for retry decisions. |
| Building from zero, want every surface wired up out of the box | `pnpm create mobile-surfaces`. The starter ships the Mobile Surfaces bridge as the default; swap to `expo-live-activity` later if needed (the adapter boundary at `apps/mobile/src/liveActivity/index.ts` is a one-file swap point). |
| Foreign Expo project, want to harden against silent ActivityKit failures | `npx mobile-surfaces audit .`. No package install; the audit reads `app.json`, `package.json`, and the iOS target config and reports against the trap catalog. |
| AI coding assistant working in a Live Activity codebase | Point the assistant at `AGENTS.md` / `CLAUDE.md` (generated from the catalog). The catalog is the grounding artifact regardless of which bridge the project uses. |

The thing the Mobile Surfaces packages do that nothing else in the ecosystem does is treat ActivityKit's silent-failure modes as a first-class, enforceable contract. That value compounds when the project is multi-surface, multi-developer, or backend-heavy. It's negligible when the project is one Lock Screen panel maintained by one author who has already paid for every trap on their own device.

Pick the layer of the stack that matches the work that's left.
