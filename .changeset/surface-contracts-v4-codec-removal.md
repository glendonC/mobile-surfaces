---
"@mobile-surfaces/surface-contracts": major
---

Remove the frozen v4 schema codec. Per the versioning charter a deprecated codec lives at least one full major past the release that announced its deprecation; v4 was announced as deprecated at 6.0, carried through its final-warning major at 8.0, and is removed at 9.0.

The following public exports are removed: `liveSurfaceSnapshotV4`, `LiveSurfaceSnapshotV4`, `migrateV4ToV5`, `safeParseAnyVersion`, and the `SafeParseAnyVersionResult`, `SafeParseAnyVersionSuccess`, and `SafeParseAnyVersionFailure` result types. The `schema-v4.ts` source file is deleted. The package validates strictly against the current wire generation; there is no multi-version codec.

Callers that used `safeParseAnyVersion` to tolerate older payloads move to `safeParseSnapshot` (non-throwing) or `assertSnapshot` (throwing), both of which validate strictly against `schemaVersion: "5"`. A payload on an older generation now fails parse and must be migrated by its producer first.

Consumers holding v4 payloads at rest must pin `@mobile-surfaces/surface-contracts@8.x` once, run `safeParseAnyVersion` to promote v4 to v5, store the result, then upgrade to 9.x.

`schemaVersion` stays at `"5"`. This release is codec retirement, not a wire-format bump. `@mobile-surfaces/validators` and `@mobile-surfaces/traps` cut majors in lockstep per the linked release group with no API change of their own.
