---
title: "Mobile Surfaces and expo-live-activity"
description: "Cooperative positioning: what each project owns, when to use both, and the decision matrix."
order: 200
group: "Compare"
---
# Mobile Surfaces and `expo-live-activity`

[`expo-live-activity`](https://github.com/software-mansion-labs/expo-live-activity) is the established Expo bridge for iOS Live Activities, maintained by Software Mansion. It is a focused, well-engineered native module: start, update, end an Activity from JavaScript, expose push tokens, render Dynamic Island. If you only need Lock Screen and Dynamic Island and you have a backend already, it is the right choice.

Mobile Surfaces is not a competitor. It is the layer above any iOS bridge: the wire format, the push client, and the catalog of silent-failure modes that turn ActivityKit code into a debugging-session generator. The two projects own different parts of the stack, and the install path explicitly supports running both at once.

## What each project owns

| Concern | `expo-live-activity` | `@mobile-surfaces/surface-contracts` | `@mobile-surfaces/push` | `@mobile-surfaces/traps` (catalog) |
| --- | --- | --- | --- | --- |
| iOS bridge: `Activity.request`, `Activity.update`, `Activity.end` | yes | no | no | no |
| Dynamic Island layouts (compact, minimal, expanded) | yes | no | no | no |
| `relevanceScore`, `staleDate`, small images, ActivityKit knobs | yes (broad surface) | typed-through where present | typed-through where present | catalogs the failure modes |
| Push tokens (per-activity, push-to-start) | yes (subscriptions) | no | accepts the tokens at the wire layer | catalogs token-lifecycle rules (MS016, MS020, MS021, MS023) |
| Wire contract for the snapshot shape | no | yes (`LiveSurfaceSnapshot`) | uses the contract | no |
| Home-screen widget, control widget, lock accessory, StandBy | no | yes (one snapshot, six projections) | drives the alert that triggers the host write | catalogs widget App Group rules (MS013, MS025, MS036) |
| Notification surface (alert, content extension, category routing) | no | yes | yes (`client.sendNotification`) | catalogs notification rules (MS037) |
| Node APNs SDK (JWT signing, HTTP/2 multiplexing, error taxonomy, retry, broadcast channels) | no | no | yes | catalogs APNs reason rules (MS011, MS014, MS018, MS028, MS030, MS031, MS032, MS034, MS035) |
| Catalog of silent-failure modes (<!-- catalog-stats:live -->41<!-- /catalog-stats:live --> documented; <!-- catalog-stats:prGated -->24<!-- /catalog-stats:prGated --> PR-gated in `surface:check`) | no | no | no | yes |
| AI-coding-assistant grounding artifact (`AGENTS.md`, `CLAUDE.md`) | no | no | no | yes |

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

**2. The bridge stops at the token.** A production APNs client is ES256 JWT signing with a 50-minute cache refresh (Apple's token TTL is 60 minutes; the 10-minute headroom absorbs clock skew), single-session HTTP/2 multiplexing with reconnect, retry policy that respects priority budgets (priority 10 sends are silently throttled past Apple's quota), typed errors for every documented APNs reason code, and channel management for iOS 18 broadcast push. `@mobile-surfaces/push` is the Node-side library that does that work; the bridge hands you a token, the push client is what you send through.

**3. The catalog catches what the bridge can't see.** <!-- catalog-stats:live -->40<!-- /catalog-stats:live --> invariants in `data/traps.json` enumerate every silent-failure mode iOS has: App Group identity mismatches that render placeholder forever, push tokens from the wrong environment that fail with 400 BadDeviceToken, the `.push-type.liveactivity` topic suffix that has to be appended exactly once, the iOS 18 broadcast capability that's invisible until the first send fails. <!-- catalog-stats:prGated -->23<!-- /catalog-stats:prGated --> of those rules are PR-gated by scripts in `surface:check`; another <!-- catalog-stats:runtime -->9<!-- /catalog-stats:runtime --> surface as typed errors from the push SDK at call time (payload size, missing env vars, expired provider tokens, channel management); the remaining <!-- catalog-stats:remainder -->8<!-- /catalog-stats:remainder --> are advisory or toolchain-preflight notes. To run the catalog against a project that is not this repo, clone Mobile Surfaces and use `pnpm surface:audit --root <path>`; the static and config gates that apply to a foreign project run against it directly.

## What you give up by choosing the Mobile Surfaces bridge

The Mobile Surfaces repo ships its own ActivityKit bridge as `@mobile-surfaces/live-activity`. It is narrower than `expo-live-activity`:

- Smaller ActivityKit knob surface. `expo-live-activity` exposes custom small images, compact-trailing fallbacks, and other ActivityKit options that the Mobile Surfaces bridge has not yet absorbed. `relevanceScore` is supported.
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
| Building from zero, want every surface set up end to end | `pnpm create mobile-surfaces`. The starter ships the Mobile Surfaces bridge as the default; swap to `expo-live-activity` later if needed (the adapter boundary at `apps/mobile/src/liveActivity/index.ts` is a one-file swap point). |
| Foreign Expo project, want to harden against silent ActivityKit failures | Clone Mobile Surfaces and run `pnpm surface:audit --root <path>` against your project, or read the catalog at [`/traps`](/traps) and apply each `error`-severity rule manually. |
| AI coding assistant working in a Live Activity codebase | Point the assistant at `AGENTS.md` / `CLAUDE.md` (generated from the catalog). The catalog is the grounding artifact regardless of which bridge the project uses. |

The thing the Mobile Surfaces packages do that nothing else in the ecosystem does is treat ActivityKit's silent-failure modes as a first-class, enforceable contract. That value compounds when the project is multi-surface, multi-developer, or backend-heavy. It's negligible when the project is one Lock Screen panel maintained by one author who has already paid for every trap on their own device.

Pick the layer of the stack that matches the work that's left.
