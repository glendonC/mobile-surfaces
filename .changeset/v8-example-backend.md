---
---

Initial 0.1.0 release of `@mobile-surfaces/example-domain`. Extracts the `DeliveryOrder` domain type, `deliveryToSnapshot` projection family, `mockTickOrder` / `initialDeliveryOrder` helpers, and the stage-mapping tables from `apps/mobile/src/example/delivery.ts` into a workspace package so the new example backend (`apps/example-backend/`) and the mobile screen (`apps/mobile/src/screens/DeliveryExampleScreen.tsx`) share one source of truth for the reference projection. The wire-boundary parse pattern documented in the source comment is unchanged from v7.

Resolves the v8-plan dependency-direction smell that a backend would otherwise have to import from `apps/mobile/src/`.

(Empty front-matter on purpose — this is the changeset entry for context, but the package ships at the 0.1.0 already declared in `packages/example-domain/package.json` rather than receiving a changesets-driven bump.)
