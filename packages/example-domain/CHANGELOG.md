# @mobile-surfaces/example-domain

## 0.1.0

### Minor Changes

- Initial release. Extracts the `DeliveryOrder` domain type and `deliveryToSnapshot` projection family from `apps/mobile/src/example/delivery.ts` into a workspace package so the example backend (`apps/example-backend/`) and the mobile screen (`apps/mobile/src/screens/DeliveryExampleScreen.tsx`) share one source of truth for the reference projection. The wire-boundary parse pattern documented in the source comment is unchanged from v7.
