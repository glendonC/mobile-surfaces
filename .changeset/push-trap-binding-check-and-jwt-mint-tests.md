---
"@mobile-surfaces/push": patch
---

- `check-trap-error-binding.mjs` now verifies that every ApnsError subclass cited in a trap's `errorClasses` array is reachable through `reasonToError`'s switch. The earlier check confirmed the class existed in errors.ts but said nothing about runtime dispatch; if a future trap added a new APNs reason without wiring `reasonToError`, observability hooks doing `err instanceof XxxError` would silently miss it.
- Three new tests on `JwtCache` pin the synchronous-mint invariant documented in jwt.ts. Counting `crypto.createSign` calls catches the regression where a future `await` inside the mint branch would let two concurrent gets at the same now() both pass the freshness check and both mint.
