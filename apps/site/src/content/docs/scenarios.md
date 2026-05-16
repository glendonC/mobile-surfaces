---
title: "Scenarios"
description: "Canonical multi-step flows that exercise every surface kind from one shared shape."
order: 8
group: "Reference"
---

A scenario is a sequence of snapshot steps that lights up every surface kind in lockstep. The repo ships two: a package delivery and a CI build. Each step is a set of five pre-projected `LiveSurfaceSnapshot` values (one per surface kind), so applying a step refreshes the Lock Screen Live Activity, home widget, control, lock accessory, and StandBy in a single action.

Scenarios live as JSON under `data/scenarios/` and are exposed in TypeScript via `@mobile-surfaces/surface-contracts/scenarios`. Use them as worked examples when wiring a real domain.

## Package delivery

Source: `data/scenarios/delivery.json`. Four steps move a package from depot to doorstep.

| Step | State | Live Activity | Widget | Control | Lock accessory | StandBy |
| --- | --- | --- | --- | --- | --- | --- |
| **1. Queued at depot** | `queued` | "Delivery queued" - progress 0 - stage `prompted` | "Delivery queued" - progress 0 - reload `manual` | "Notify on arrival" toggle on - intent `notifyOnArrivalIntent` | "Queued" - circular gauge 0 | "Delivery queued" - presentation `card` |
| **2. Out for delivery** | `active` | "Out for delivery" - progress 0.55 - stage `inProgress` - statusLine "in transit - ETA 12 min" | "Out for delivery" - progress 0.55 | toggle on - intent `notifyOnArrivalIntent` | "In transit" - circular gauge 0.55 | "Out for delivery" - presentation `card` |
| **3. Arrived** | `active` | "Driver arriving" - progress 0.95 - stage `inProgress` - actionLabel "Open door" | "Arriving now" - progress 0.95 | toggle on | "Arriving" - circular gauge 0.95 - shortText "now" | "Driver arriving" - presentation `card` - tint set |
| **4. Delivered** | `completed` | "Delivered" - progress 1 - stage `completing` | "Delivered" - progress 1 | toggle off | "Done" - circular gauge 1 | "Delivered" - presentation `night` |

The full JSON for each step is in `data/scenarios/delivery.json`. Each step carries five snapshots under `snapshots: { liveActivity, widget, control, lockAccessory, standby }`. Every snapshot validates against `liveSurfaceSnapshot`.

### Replaying the scenario in your app

```ts
import { deliveryScenario } from "@mobile-surfaces/surface-contracts";
import { liveActivityAdapter as LiveActivity } from "./liveActivity";
import {
  refreshWidgetSurface,
  refreshLockAccessorySurface,
  refreshStandbySurface,
  toggleControlSurface,
} from "./surfaceStorage";

async function applyStep(stepId: string) {
  const step = deliveryScenario.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`unknown step ${stepId}`);
  const { liveActivity, widget, control, lockAccessory, standby } = step.snapshots;
  await LiveActivity.update(liveActivity);
  await refreshWidgetSurface(widget);
  await toggleControlSurface(control);
  await refreshLockAccessorySurface(lockAccessory);
  await refreshStandbySurface(standby);
}

// Walk the whole flow:
for (const step of deliveryScenario.steps) {
  await applyStep(step.id);
  await new Promise((r) => setTimeout(r, 3000));
}
```

The same loop works for a real backend: replace `applyStep` with a call to your service that emits the next step and `client.update(token, snapshot)` for each surface.

## CI build

Source: `data/scenarios/build.json`. A second scenario for a continuous-integration build flow (queued, running, passing/failing). Useful as a second worked example with different state semantics.

## Why scenarios exist as JSON

Two reasons. First, JSON keeps the canonical flow language-neutral: a Swift unit test, a Python backend, and the TS scaffold all consume the same source. Second, the discriminator-strict parse in `liveSurfaceSnapshot` validates every step at load time, so a malformed scenario fails CI rather than rendering placeholder data on device.

`scripts/generate-scenarios.mjs --check` runs in `pnpm surface:check` to keep the generated TypeScript exports in sync with the JSON sources. Edit the JSON; the TS regenerates.
