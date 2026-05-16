---
"@mobile-surfaces/surface-contracts": major
"@mobile-surfaces/validators": major
"@mobile-surfaces/traps": major
"@mobile-surfaces/push": minor
"@mobile-surfaces/live-activity": minor
"@mobile-surfaces/tokens": minor
"create-mobile-surfaces": minor
---

v3 codec retirement. Per the versioning charter, a deprecated codec lives for at least one major past the release that deprecated it; v3 was first deprecated at 5.0 and ages out at 8.0.

surface-contracts drops `liveSurfaceSnapshotV3`, `migrateV3ToV4`, `LiveSurfaceSnapshotV3`, the `V3_DEPRECATION_WARNING` constant, and the v3 branch in `safeParseAnyVersion`. The codec chain narrows to v5 → v4. The v4 codec's deprecation prose moves from "removed in 8.0.0" to "removed in 9.0.0" so the MS042 gate stays satisfied.

Consumers with v3 payloads at rest must pin `@mobile-surfaces/surface-contracts@7.x` once, run `safeParseAnyVersion` to promote v3 → v5, store the result, then upgrade.

`schemaVersion` stays at `"5"`. This release is codec retirement, not a wire-format bump.

`@mobile-surfaces/validators` and `@mobile-surfaces/traps` cut majors in lockstep per the linked release group with no API change of their own.

`@mobile-surfaces/push`, `@mobile-surfaces/live-activity`, `@mobile-surfaces/tokens`, and `create-mobile-surfaces` cut minors for the linked dependency range update; no API change.
