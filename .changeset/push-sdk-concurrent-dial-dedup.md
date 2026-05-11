---
"@mobile-surfaces/push": minor
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"create-mobile-surfaces": patch
---

Dedup concurrent dials in `Http2Client.#ensureSession()`. When N callers hit `#ensureSession` while no session is open, they now all await the same `#dial()` promise instead of each opening their own. The in-flight promise is held in a single slot cleared in `.finally`, so a failed dial doesn't poison subsequent attempts. Previously cold-start parallel sends cost N TLS handshakes for N concurrent requests; post-GOAWAY recovery cost an extra dial per recovering stream.

Treat `NGHTTP2_INTERNAL_ERROR` on `ERR_HTTP2_STREAM_ERROR` as a retryable transport condition. Node surfaces session-level destruction as `ERR_HTTP2_SESSION_ERROR` when there's one in-flight stream, but as `NGHTTP2_INTERNAL_ERROR` on each stream when there are multiple. The single-stream path was already retried (the session-error code is in `RETRYABLE_TRANSPORT_CODES`); this aligns the parallel-stream path with the same behavior.

Add two test scenarios to `packages/push/test/client.test.mjs`: cold-start parallel sends share a single dial; parallel stream-resets recover via a single shared warm session. The first test would have caught the dial-dedup gap (sessionCount = 5 instead of 1 for 5 concurrent cold sends); the second pins the per-stream-reset recovery path.
