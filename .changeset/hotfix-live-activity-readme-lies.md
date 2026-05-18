---
"@mobile-surfaces/live-activity": patch
---

README accuracy fix. The "What this package does not do" section claimed three things the package actually does:

1. **Payload validation**: `start` / `update` Zod-parse their `LiveActivityContentState` argument and throw `InvalidContentStateError` on a mismatch (MS038); the README previously claimed "the native bridge trusts what JS hands it."
2. **`relevanceScore`**: supported as an option on `start` / `update` and threaded JS to Swift; the README previously listed it among unsupported APIs.
3. **`getPushToStartToken()`**: returns the cached value of the most recent `onPushToStartToken` emission this process has seen; the README previously claimed it "always resolves null."

No code change. The lies were doc-only.
