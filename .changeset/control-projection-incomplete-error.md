---
"@mobile-surfaces/surface-contracts": minor
---

Tighten `toControlValueProvider` so a control snapshot that parses against the schema but has neither a non-empty `actionLabel` nor a non-empty `primaryText` throws a new exported `IncompleteProjectionError` instead of emitting a silently-empty button label downstream. `actionLabel` is `z.string().optional()` and accepts empty strings, so the previous `??` fallback never fired on `""`; the projection now treats empty `actionLabel` as absent before falling back, and refuses to project at all when both candidate labels are empty. `IncompleteProjectionError` carries `projection` and `field` properties so observability hooks can route on either. Callers that always supplied a non-empty `actionLabel` or `primaryText` are unaffected; callers that relied on the silent empty-label behavior need to either fill one of those fields or catch `IncompleteProjectionError`.
