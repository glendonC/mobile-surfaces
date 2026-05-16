# @mobile-surfaces/example-domain

Reference domain and projection family for the Mobile Surfaces example backend and the mobile app's DeliveryExampleScreen. Demonstrates the wire-boundary parse pattern that's load-bearing for every Mobile Surfaces project: domain state → projection → `safeParseSnapshot` → adapter / App Group / APNs.

`DeliveryOrder` is the canonical "real app" shape this repository points to: a small domain type, one projection family, and every surface kind populated from the same source of record. Production code substitutes its own domain type and its own projection family; the shape here is opinionated only inasmuch as it covers every snapshot kind v5 ships — replace `DeliveryOrder` with `RideRequest`, `Build`, `MatchScore`, etc., and the rest of the surface plumbing stays the same.

## Install

```bash
npm install @mobile-surfaces/example-domain @mobile-surfaces/surface-contracts
```

This package is a workspace member of the Mobile Surfaces repo; it ships at `0.1.x` as a versioned-but-pre-1.0 reference. The shape is stable across the v5 schema generation but may evolve when the snapshot schema bumps.

## Use

```ts
import { deliveryToSnapshot, type DeliveryOrder } from "@mobile-surfaces/example-domain";
import { safeParseSnapshot } from "@mobile-surfaces/surface-contracts";

const order: DeliveryOrder = {
  id: "ord-123",
  restaurant: "Late Night Tacos",
  itemCount: 2,
  stage: "out_for_delivery",
  placedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  etaMinutes: 8,
  driverName: "Sam",
  deepLink: "myapp://orders/ord-123",
  updatedAt: new Date().toISOString(),
};

const snapshot = deliveryToSnapshot(order, "liveActivity");
const parsed = safeParseSnapshot(snapshot);
// parsed.success is true; parsed.data is a strongly-typed LiveSurfaceSnapshot.
```

The projection family covers every `kind` in the v5 schema: `liveActivity`, `widget`, `control`, `lockAccessory`, `standby`, `notification`. See the source comment in `src/index.ts` for the per-kind mapping.

## See also

- [`apps/example-backend/`](../../apps/example-backend) — single-file Node server that demonstrates the end-to-end domain → projection → APNs loop.
- [`apps/mobile/src/screens/DeliveryExampleScreen.tsx`](../../apps/mobile/src/screens/DeliveryExampleScreen.tsx) — the mobile-side counterpart.
- [`@mobile-surfaces/surface-contracts`](../surface-contracts) — the canonical wire format the projection lands in.
