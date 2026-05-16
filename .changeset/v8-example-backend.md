---
"@mobile-surfaces/example-domain": minor
---

Initial 0.1.0 release. Extracts the `DeliveryOrder` domain type, `deliveryToSnapshot` projection family, `mockTickOrder` / `initialDeliveryOrder` helpers, and the stage-mapping tables from `apps/mobile/src/example/delivery.ts` into a workspace package so the new example backend (`apps/example-backend/`) and the mobile screen (`apps/mobile/src/screens/DeliveryExampleScreen.tsx`) share one source of truth for the reference projection. The wire-boundary parse pattern documented in the source comment is unchanged from v7.

Resolves the v8-plan dependency-direction smell that a backend would otherwise have to import from `apps/mobile/src/`.
