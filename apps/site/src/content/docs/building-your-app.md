---
title: "Building your app on Mobile Surfaces"
description: "How to move from the surface harness to a production app that emits real snapshots."
order: 6
group: "Start here"
---

The starter scaffolds a **surface harness**: a fixture-driven playground where every button fires a canonical snapshot. The harness is a testing appliance, not a template for a production app. It exists so you can verify that the Lock Screen, Dynamic Island, home widget, control, lock accessory, and StandBy surfaces all render correctly against the bridge before you write any application logic.

This page is the walk from "the harness works" to "my app produces real snapshots from real domain events."

## What the harness is and is not

The harness:

- Lives in `apps/mobile/src/screens/LiveActivityHarness.tsx`.
- Imports canonical fixtures from `apps/mobile/src/fixtures/surfaceFixtures.ts` (which re-export from `@mobile-surfaces/surface-contracts`).
- Wires every button to a snapshot through `liveActivityAdapter.start/update/end` and `apps/mobile/src/surfaceStorage/index.ts`.
- Exercises every shipped surface kind so a code change that breaks a renderer fails loudly in the harness before it reaches a real device.

The harness does **not**:

- Manage application state (no Redux/Zustand/Context, no persistence layer).
- Talk to a backend (no fetch, no websocket, no retry logic).
- Demonstrate error recovery beyond surfacing the typed error in `TrapErrorCard`.
- Show token forwarding to a backend (it captures the push token, but it does not send it anywhere).

These are deliberate omissions. The harness pins surface rendering; your app pins the rest.

## The pieces you keep

The harness is the entry point that you replace. Everything around it is reusable plumbing that your app should keep:

| Path | What it does | Keep |
| --- | --- | --- |
| `apps/mobile/src/liveActivity/index.ts` | Re-exports the live-activity adapter. Single boundary per MS001; swap implementations here, not at call sites. | Yes |
| `apps/mobile/src/surfaceStorage/index.ts` | Writes projected snapshots into the App Group container for the widget extension to read. Handles typed `SurfaceStorageError`. | Yes |
| `apps/mobile/src/theme.ts` | Surface color tokens used by the harness UI. | Yes (or replace with your design system) |
| `apps/mobile/src/diagnostics/` | Runtime probes (`checkSetup`) that detect missing entitlements, unsupported OS, etc. | Yes |
| `apps/mobile/src/tokens/` | Token store + forwarding scaffold. Wire `forwardToken.ts` to your backend. | Yes |
| `apps/mobile/src/generated/appGroup.ts` | Generated App Group identifier. Do not edit by hand. | Yes |
| `apps/mobile/src/screens/LiveActivityHarness.tsx` | The fixture harness. | Replace |
| `apps/mobile/src/fixtures/surfaceFixtures.ts` | Re-export of canonical fixtures. Useful for tests; not needed in a production screen. | Optional |

## Worked example: a package-delivery flow

The repo ships a complete scenario (`data/scenarios/delivery.json`) that defines four steps across all five surfaces. The shape is the canonical wire format every projection helper accepts. Use it as the structure for your own domain.

### 1. Domain types

```ts
// apps/mobile/src/types/delivery.ts
export type DeliveryStatus = "queued" | "active" | "completed";

export interface Delivery {
  id: string;
  recipient: string;
  status: DeliveryStatus;
  progress: number;          // 0..1
  etaSeconds: number;
  step: "queued" | "out-for-delivery" | "arrived" | "delivered";
}
```

### 2. Snapshot derivation

Write one function per surface kind. Each takes your domain object and returns the matching `LiveSurfaceSnapshot`:

```ts
// apps/mobile/src/services/delivery/snapshots.ts
import type { LiveSurfaceSnapshot } from "@mobile-surfaces/surface-contracts";
import type { Delivery } from "../../types/delivery";

export function deliveryToLiveActivity(d: Delivery): LiveSurfaceSnapshot {
  return {
    schemaVersion: "4",
    kind: "liveActivity",
    id: `delivery-${d.id}-${d.step}`,
    surfaceId: `delivery-${d.id}`,
    updatedAt: new Date().toISOString(),
    state: d.status,
    liveActivity: {
      title: d.step === "queued" ? "Delivery queued" : "On its way",
      body: `${d.recipient} - ${Math.round(d.progress * 100)}% complete`,
      progress: d.progress,
      deepLink: `myapp://delivery/${d.id}`,
      modeLabel: d.step,
      contextLabel: "depot",
      statusLine: d.etaSeconds > 0 ? `ETA ${Math.round(d.etaSeconds / 60)} min` : "Arrived",
      stage: d.status === "completed" ? "completing" : "inProgress",
      estimatedSeconds: d.etaSeconds,
      morePartsCount: 0,
    },
  };
}
```

Do the same for `kind: "widget"`, `kind: "control"`, `kind: "lockAccessory"`, `kind: "standby"`. Each derivation reads from the same `Delivery` so they cannot drift.

### 3. State management

Your app needs to store the active deliveries and refresh the surfaces when state changes. Use any state manager you like (React state, Redux, Zustand). The contract is:

```ts
// apps/mobile/src/hooks/useDelivery.ts
import { useEffect, useState } from "react";
import { liveActivityAdapter as LiveActivity } from "../liveActivity";
import { refreshWidgetSurface, refreshLockAccessorySurface, refreshStandbySurface, toggleControlSurface } from "../surfaceStorage";
import { deliveryToLiveActivity, deliveryToWidget, deliveryToControl, deliveryToLockAccessory, deliveryToStandby } from "../services/delivery/snapshots";
import type { Delivery } from "../types/delivery";

export function useDelivery(delivery: Delivery | null) {
  useEffect(() => {
    if (!delivery) return;
    const liveActivity = deliveryToLiveActivity(delivery);
    LiveActivity.update(liveActivity).catch(console.error);

    refreshWidgetSurface(deliveryToWidget(delivery)).catch(console.error);
    refreshLockAccessorySurface(deliveryToLockAccessory(delivery)).catch(console.error);
    refreshStandbySurface(deliveryToStandby(delivery)).catch(console.error);
    toggleControlSurface(deliveryToControl(delivery)).catch(console.error);
  }, [delivery]);
}
```

### 4. Backend integration

Your backend needs the per-activity push token so it can send updates without waking the app. Forward it at mount time:

```ts
// apps/mobile/src/App.tsx
import { useEffect } from "react";
import { liveActivityAdapter as LiveActivity } from "./liveActivity";
import { forwardToken } from "./tokens/forwardToken";

export default function App() {
  useEffect(() => {
    // Per MS016: subscribe at mount, not on demand. iOS only delivers
    // push-to-start tokens through the AsyncSequence.
    const pushToStart = LiveActivity.addListener("onPushToStartToken", ({ token }) => {
      forwardToken({ kind: "push-to-start", token }).catch(console.error);
    });
    const perActivity = LiveActivity.addListener("onPushToken", ({ activityId, token }) => {
      forwardToken({ kind: "per-activity", activityId, token }).catch(console.error);
    });
    const stateChange = LiveActivity.addListener("onActivityStateChange", ({ activityId, state }) => {
      if (state === "ended" || state === "dismissed") {
        // Per MS021: discard per-activity tokens when the activity ends.
        forwardToken({ kind: "discard", activityId }).catch(console.error);
      }
    });
    return () => {
      pushToStart.remove();
      perActivity.remove();
      stateChange.remove();
    };
  }, []);
  // ... your domain screen
}
```

Your `forwardToken` implementation talks to your service. Use whatever HTTP/auth pattern you already have.

### 5. Backend send

On your service, when a delivery state changes, derive the snapshot and send it through `@mobile-surfaces/push`:

```ts
// backend/services/delivery-push.ts
import { createPushClient, BadDeviceTokenError, UnregisteredError } from "@mobile-surfaces/push";
import { deliveryToLiveActivity } from "../snapshots";

const client = createPushClient({
  keyId: process.env.APNS_KEY_ID!,
  teamId: process.env.APNS_TEAM_ID!,
  keyPath: process.env.APNS_KEY_PATH!,
  bundleId: process.env.APNS_BUNDLE_ID!,
  environment: process.env.NODE_ENV === "production" ? "production" : "development",
});

export async function pushDeliveryUpdate(delivery: Delivery, activityToken: string) {
  const snapshot = deliveryToLiveActivity(delivery);
  try {
    await client.update(activityToken, snapshot);
  } catch (err) {
    if (err instanceof UnregisteredError || err instanceof BadDeviceTokenError) {
      // Per MS020 / MS021: the token rotated or the activity ended.
      // Drop the token from your store and stop sending to it.
      await dropToken(activityToken);
      return;
    }
    throw err;
  }
}
```

See the [Push reference](/docs/push) for the full taxonomy of typed APNs errors and which are retryable, terminal, or token-rotation signals.

## Migration steps

Concrete order to go from the harness to your app:

1. **Branch.** Make sure the harness still works on simulator before you change anything: `pnpm mobile:sim`, tap a few buttons, verify all five surfaces render.
2. **Add your domain types** under `apps/mobile/src/types/`.
3. **Write the projection functions** under `apps/mobile/src/services/<your-domain>/snapshots.ts`. Use the [Multi-surface](/docs/multi-surface) doc as a per-kind reference.
4. **Add your screen** under `apps/mobile/src/screens/<YourScreen>.tsx`. Import `liveActivityAdapter` and the surface-storage helpers exactly the way `LiveActivityHarness.tsx` does.
5. **Replace the App entry** to point at your new screen. The harness can stay in the file tree as an internal QA tool; just stop importing it from `App.tsx`.
6. **Wire token forwarding** to your backend in a mount-time `useEffect`. Mirror the example above.
7. **Implement your backend sender** with `@mobile-surfaces/push`. Start with `client.alert` for a smoke test, then move to `client.update` for per-activity pushes and `client.broadcast` for iOS 18 channel pushes.
8. **Run** `pnpm surface:check` and `pnpm typecheck`. Every snapshot you emit has to parse as `LiveSurfaceSnapshot`; CI catches drift before a customer device does.

## What to read next

- [Scenarios](/docs/scenarios) - the canonical delivery scenario rendered step by step across all surfaces.
- [Multi-surface](/docs/multi-surface) - every `kind` value and which fields its slice requires.
- [Backend integration](/docs/backend-integration) - domain event to snapshot to APNs in more detail.
- [Push](/docs/push) - typed error classes, retry policy, channel push, token taxonomy.
- [Observability](/docs/observability) - hook signatures and recommended log shape.
