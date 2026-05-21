---
"@mobile-surfaces/push": minor
---

Complete the APNs error taxonomy so there is a typed `ApnsError` subclass for
every documented APNs reason. Adds 14 classes (`BadCollapseIdError`,
`BadMessageIdError`, `BadTopicError`, `DeviceTokenNotForTopicError`,
`DuplicateHeadersError`, `IdleTimeoutError`, `MissingDeviceTokenError`,
`PayloadEmptyError`, `BadCertificateError`, `BadCertificateEnvironmentError`,
`MissingProviderTokenError`, `BadPathError`, `MethodNotAllowedError`,
`TooManyProviderTokenUpdatesError`) and their `reasonToError` cases; reasons
previously fell through to `UnknownApnsError`.

The reason set now has a single source of truth at `data/apns-reasons.json`.
`packages/push/src/reasons.ts` is generated from it, and a new
`check-apns-reason-coverage` gate fails CI if `errors.ts` or the published
error-response table drift from that source. `RETRYABLE_TRANSPORT_CODES` moved
to `transport.ts` (an internal module; not part of the public export surface).
Retry classification is unchanged.
