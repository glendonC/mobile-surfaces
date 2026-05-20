---
"@mobile-surfaces/surface-contracts": minor
---

Drop the `z.lazy()` wrapper from `liveSurfaceSnapshot`. The wrapper deferred discriminated-union construction to first parse, with a stated rationale around serverless cold-start cost that was never benchmarked. Removing the wrapper recovers downstream type narrowing that the lazy proxy interfered with. The variants stay eagerly built (they are independently exported), and `.parse` / `.safeParse` behavior is unchanged.

Two contract-protecting scripts were also tightened, with no public-surface impact:

- `scripts/check-projection-envelope-version.mjs` (MS041) no longer requires `schemaVersion` to be the first property of a projection-output schema. The Swift-side Codable mirror decodes by key name, so property order in the Zod source never reached the wire. The literal-type check that schemaVersion equals the canonical version is retained as the load-bearing part.
- `scripts/check-activity-attributes.mjs` `isStageEnum` helper now reads `schema.options` (public Zod API) instead of `schema._zod.def.entries` (private internals). A regression test pins the public surface so a future Zod bump that removes the property fails the test rather than silently misbehaving in CI.
