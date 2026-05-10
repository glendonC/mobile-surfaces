---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

@mobile-surfaces/push: production-readiness pass.

- Add UnregisteredError typed class for APNs 410 responses and bind it to MS020. Backends can now distinguish a rotated or terminated token from genuinely unknown reasons without string-matching the reason field.
- Close a narrow GOAWAY race in Http2Client. If APNs sent GOAWAY between session establishment and request dispatch, the SDK could issue a request on a session that had already been dropped from the cache. The request layer now validates the session is still current and re-dials once before dispatch, so a flapping connection surfaces as a transport error to the retry layer rather than racing.
- Sanitize APNs key file errors. resolveKeyPem in @mobile-surfaces/push and the loadApnsKey helper in scripts/send-apns.mjs no longer surface the resolved absolute key path on read failure; ENOENT, EACCES, and EISDIR map to a path-free message. A 64 KB size guard rejects misconfigured paths early.
- Document JWT cache concurrency. JwtCache is safe for concurrent in-flight requests on a single Node event loop but does not synchronize across worker_threads or cluster workers; the docstring now states the contract explicitly.
- New transport tests: GOAWAY mid-flight reconnects on a fresh session; parallel sends multiplex over a single session; idle timeout closes the session and the next send reconnects; Http2Client surfaces per-request timeouts as ETIMEDOUT-coded errors.
