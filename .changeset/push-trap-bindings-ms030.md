---
"@mobile-surfaces/push": patch
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"create-mobile-surfaces": patch
---

Add trap entry MS030 (APNs provider token must be valid and current) and bind `ForbiddenError`, `InvalidProviderTokenError`, and `ExpiredProviderTokenError` to it. Observability hooks reading `err.trapId` now return `"MS030"` for these three 403 auth-failure modes instead of `undefined`, so log aggregators and the diagnose bundle can route them to the catalog entry. The catalog's fix section distinguishes the three operator responses (mint a new key vs verify key/team ids vs check clock skew).
