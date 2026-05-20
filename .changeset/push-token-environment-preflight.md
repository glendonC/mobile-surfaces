---
"@mobile-surfaces/push": minor
---

Send methods (`update`, `start`, `end`, `sendNotification`, `sendAlert`) gain an optional `tokenEnvironment` send option. When supplied, the SDK rejects with a new `TokenEnvironmentMismatchError` before the round-trip if the token's environment disagrees with the environment the `PushClient` was constructed for.

APNs push tokens are environment-specific: a token minted by a dev-client or `expo run:ios` build authenticates only against the development APNs host, a TestFlight or App Store token only against production. Sending one to the wrong host fails with a 400 `BadDeviceToken` that gives no hint the cause is an environment mismatch. This is catalog rule MS014, which until now surfaced only as that opaque 400. Threading the stored token environment through `tokenEnvironment` converts it into a precise pre-send error naming both environments.

The option is opt-in and backward compatible: a caller passing a bare token string with no `tokenEnvironment` behaves exactly as before (the 400 remains the fallback). The `@mobile-surfaces/tokens` record carries `environment`, so a backend storing tokens through that package has the value to pass; the example backend now threads it on both its Live Activity and notification sends as the reference usage.

New public export: `TokenEnvironmentMismatchError` (subclass of `MobileSurfacesError`, fields `tokenEnvironment` and `clientEnvironment`, bound to catalog rule MS014). `broadcast` is unaffected — it targets a channel, not a device token, and ignores the option.
