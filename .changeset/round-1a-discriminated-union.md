---
"@mobile-surfaces/surface-contracts": minor
"@mobile-surfaces/design-tokens": minor
"@mobile-surfaces/live-activity": minor
"create-mobile-surfaces": minor
---

Tighten `liveSurfaceSnapshot` into a true `kind`-discriminated union and add a v0→v1 migration codec.

- `liveSurfaceSnapshot` is now `z.discriminatedUnion("kind", [...])` over six per-kind variants. Each variant requires its own slice (`widget`, `control`, `notification`) where applicable, so `{kind: "control"}` without a `control` slice no longer parses.
- Per-kind variant schemas (`liveSurfaceSnapshotLiveActivity`, `liveSurfaceSnapshotWidget`, `liveSurfaceSnapshotControl`, `liveSurfaceSnapshotNotification`, `liveSurfaceSnapshotLockAccessory`, `liveSurfaceSnapshotStandby`) and their inferred types are now exported.
- A `.preprocess` wrapper preserves the existing "missing `kind` defaults to `liveActivity`" behavior so externally-stored v1 payloads keep parsing.
- Adds `liveSurfaceSnapshotV0`, `migrateV0ToV1`, and `safeParseAnyVersion` for promoting historical v0 payloads. `assertSnapshot` / `safeParseSnapshot` continue to validate strictly against v1 with no auto-migration.
- Generated JSON Schema is now a `oneOf` of `const`-discriminated branches, and `$id` is pinned to `@1.0/schema.json` (major.minor) so future minors can ship a new schema URL without yanking the old one.
- `schemaVersion` stays at `"1"` (fix-forward); existing fixtures and producers that already set `kind` and matching slices remain valid.
