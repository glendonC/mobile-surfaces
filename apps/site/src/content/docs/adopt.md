---
title: "Adopt Mobile Surfaces"
description: "For teams already shipping iOS Live Activities. Add the contract and push client without forking your bridge."
order: 6
group: "Start here"
---
# Adopt Mobile Surfaces

You already ship a Live Activity. You have an Expo app with `expo-live-activity` (or a hand-rolled bridge), a backend that signs APNs JWTs, and a working `Activity.request(...)` flow. What's still painful: each surface (Lock Screen, widget, control) carries its own ad-hoc mapping function, the backend code duplicates the typed `aps` envelope shape from your iOS code, and silent ActivityKit failures still surface as "the customer screenshot looks wrong."

Mobile Surfaces does not replace your bridge. It is the layer above any iOS bridge: a typed wire contract, a Node APNs SDK, and a catalog of every silent-failure mode iOS has — enforceable in CI. Drop two packages in alongside what you already ship.

## Install

```bash
pnpm add @mobile-surfaces/surface-contracts @mobile-surfaces/push
```

Both packages are bridge-agnostic. Neither imports `expo-live-activity`, neither imports the Mobile Surfaces native module, and neither cares which one you use.

## Project your data through the contract

`LiveSurfaceSnapshot` is one discriminated union, six branches (`liveActivity`, `widget`, `control`, `notification`, `lockAccessory`, `standby`). Every surface derives its render input from the same snapshot through a `kind`-gated projection helper.

```ts
import {
  assertSnapshot,
  toLiveActivityContentState,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

function snapshotFromJob(job: Job): LiveSurfaceSnapshot {
  return {
    schemaVersion: "5",
    kind: "liveActivity",
    id: `${job.id}@${job.revision}`,
    surfaceId: `job-${job.id}`,
    updatedAt: new Date().toISOString(),
    state: job.status === "done" ? "completed" : "active",
    liveActivity: {
      title: job.title,
      body: job.subtitle ?? "",
      progress: job.progress,
      deepLink: `myapp://job/${job.id}`,
      modeLabel: "active",
      contextLabel: job.queueName,
      statusLine: `${job.queueName} · ${Math.round(job.progress * 100)}%`,
      stage: job.status === "done" ? "completing" : "inProgress",
      estimatedSeconds: job.etaSeconds ?? 0,
      morePartsCount: 0,
    },
  };
}

// On the client side: project through to whatever your bridge accepts.
const snapshot = assertSnapshot(snapshotFromJob(job));
const contentState = toLiveActivityContentState(snapshot);
// → { headline, subhead, progress, stage }
// Pass `contentState` straight into expo-live-activity, a hand-rolled native
// module, or any other ActivityKit bridge. The contract does not care.
```

The published JSON Schema at `https://unpkg.com/@mobile-surfaces/surface-contracts@7.0/schema.json` is generated from the same Zod source. Backends that prefer Ajv, jsonschema, or a Valibot-via-Standard-Schema interop can validate without depending on Zod at runtime.

## Drop in the push client

`@mobile-surfaces/push` is a Node SDK for APNs. HTTP/2 session pooling, ES256 JWT signing and rotation, typed error classes per Apple reason code, push-to-start, iOS 18 broadcast channels, channel management. One client per `(auth-key, environment, bundleId)` tuple, multiplexed across alert / Live Activity / broadcast / channel-management requests.

```ts
import { createPushClient } from "@mobile-surfaces/push";

const push = createPushClient({
  keyId: process.env.APNS_KEY_ID!,
  teamId: process.env.APNS_TEAM_ID!,
  keyPath: process.env.APNS_KEY_PATH!,
  bundleId: process.env.APNS_BUNDLE_ID!,
  environment: "development",
});

// Live Activity update against an existing per-activity push token.
await push.update(activityToken, snapshot);

// Live Activity remote start (iOS 17.2+) against the push-to-start token.
await push.start(pushToStartToken, snapshot, {
  surfaceId: snapshot.surfaceId,
  modeLabel: snapshot.liveActivity.modeLabel,
});

// End the activity.
await push.end(activityToken, snapshot);

// Alert fallback for users who have Live Activities turned off.
await push.alert(deviceToken, snapshot);
```

The SDK validates every snapshot through `liveSurfaceSnapshot.safeParse` and rejects mismatched kinds with a typed `InvalidSnapshotError` before any network call. Non-2xx APNs responses throw a typed `ApnsError` subclass per Apple reason — `BadDeviceTokenError`, `UnregisteredError`, `PayloadTooLargeError`, `TooManyRequestsError`, etc. The full taxonomy is in [`push.md`](/docs/push).

## Audit your project against the trap catalog

Mobile Surfaces ships a CLI subcommand that audits any Expo project against the silent-failure catalog without forking it:

```bash
npx mobile-surfaces audit .
```

The audit walks every static and config rule in `data/traps.json` — App Group identity across host and widget extension (MS013), iOS deployment target (MS012/MS027), App Group declaration in `app.json` (MS025), `apns-topic` bundle id discipline (MS018/MS035), workspace dependencies (MS024), gitignored `apps/mobile/ios/` (MS029) — and prints pass/warn/fail rows with MS-id chips and links to the catalog entry.

Use `--json` for CI:

```bash
npx mobile-surfaces audit . --json
```

The output is a `DiagnosticReport` (one canonical shape across every Mobile Surfaces check). Wire it into your existing PR checks; the catalog covers every silent ActivityKit failure mode that has cost a debugging session.

## Live alongside `expo-live-activity`

Both packages are designed to coexist with the established ecosystem bridge. The contract is bridge-agnostic; the push client doesn't import any native module. See [`vs-expo-live-activity.md`](/docs/vs-expo-live-activity) for the cooperative-positioning detail and a decision matrix for which Mobile Surfaces pieces add value when you're already on `expo-live-activity`.

## What to read next

- [`docs/surfaces.md`](/docs/surfaces) — every `kind` value, its projection helper, the native target it drives.
- [`docs/backend.md`](/docs/backend) — domain event to snapshot to APNs end-to-end.
- [`docs/push.md`](/docs/push) — wire-layer reference, token taxonomy, error taxonomy, broadcast channels.
- [`docs/traps.md`](/docs/traps) — trap catalog maintenance, the source `data/traps.json` consumes.
- [`docs/troubleshooting.md`](/docs/troubleshooting) — symptom-to-fix recipes for silent ActivityKit failures.
