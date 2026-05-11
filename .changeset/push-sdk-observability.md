---
"@mobile-surfaces/push": minor
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"create-mobile-surfaces": patch
---

Add three typed APNs error classes to @mobile-surfaces/push: `ForbiddenError`, `InternalServerError`, `ServiceUnavailableError`. The three reason strings were already in `APNS_REASON_GUIDE` and (for the latter two) in `DEFAULT_RETRYABLE_REASONS`, but `reasonToError` had no cases for them so they fell through to `UnknownApnsError`. Observability hooks can now discriminate the three with `instanceof`.

Fix a retry gap on RST_STREAM. Node wraps a per-stream reset as `ERR_HTTP2_STREAM_ERROR` and exposes the protocol-level code (`NGHTTP2_REFUSED_STREAM`) in the message rather than on `err.code`, so a transient REFUSED_STREAM on a single stream was surfacing as a non-retryable error even though the protocol code is in `RETRYABLE_TRANSPORT_CODES`. `isTransportError` now recognizes that wrapper. The mock APNs server gained a `rstStream` flag and the client test suite pins the new retry path.

Add an inline invariant comment on `JwtCache.get()` explaining why `mintJwt` must stay synchronous (a future `await` between the freshness check and the `#entry` assignment would let two concurrent `get()` calls both re-mint).
