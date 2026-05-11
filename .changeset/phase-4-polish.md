---
"create-mobile-surfaces": patch
"@mobile-surfaces/push": patch
---

Polish-tier audit follow-ups:

- `processFileContent` (strip.mjs) gains two edge-case tests: BEGIN/END marker id-set normalization (order-insensitive matching) and true nested regions where outer-strip swallows the inner, while outer-keep with inner-strip strips just the inner. Existing tests already covered single-id, multi-id sequential, unknown id, and unmatched begin/end. The new cases pin the id-set normalization invariant and nested-region handling so a future refactor cannot quietly regress either.
- New push client test runs six sequential GOAWAY cycles back to back. Extends the existing two-cycle pin: the SDK must dial a fresh session per destroyed session for the full burst (sessionCount asserted at 7, requests at 12). Parallel-send-during-rotation was considered but left to the dedicated cold-start dedup test, since interleaving destroys with mid-flight parallel streams makes the assertion flaky against `maxRetries: 1`.
