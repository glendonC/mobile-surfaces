---
"@mobile-surfaces/tokens": patch
---

Fix a data-loss window where `upsert` calls during the storage hydration phase wrote to the in-memory Map but never reached storage. Previously `scheduleSave` short-circuited while `hydrated` was false, so the write persisted only on the next mutation; if the app was killed between the upsert and the next mutation the record was lost.

The fix queues a single deferred save during the hydration window and flushes it once `load()` resolves (or rejects). It also resolves the merge order so a hydrated record cannot overwrite a live emission with the same idempotency key - preserving MS020 (latest-write-wins on rotation) at the boundary.

Three regression tests cover the race: upsert-then-load-completes, upsert-then-loaded-record-collides, and upsert-then-load-rejects.
