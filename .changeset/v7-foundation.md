---
"@mobile-surfaces/surface-contracts": major
"@mobile-surfaces/push": major
"@mobile-surfaces/live-activity": major
"@mobile-surfaces/validators": major
"create-mobile-surfaces": major
---

v7.0.0 coordinated release.

DRAFT — this changeset is the umbrella for the v7 refactor and will be expanded
as later phases land. The complete change list lives in `notes/refactor-v7.md`.
Headline items by phase:

- Phase 0 (this changeset, landing): retroactive 6.0 CHANGELOG entries; v3 / v4
  deprecation prose pushed to 8.0 per the stability charter; `schemaVersion: "5"`
  added to every projection-output envelope and matching Swift Codable; widget
  extensions render `MobileSurfacesVersionMismatchView` when the App Group
  snapshot's schemaVersion disagrees with the binary's `EXPECTED_SCHEMA_VERSION`
  (MS041); schema URL bumps to `@7.0/schema.json`. The wire-format
  `schemaVersion` stays `"5"`; the URL channel and the wire generation are
  independent by design (linked-group bumps can be driven by changes elsewhere
  in the family).
- Phase 1: `@mobile-surfaces/traps` package (errors-as-trap-bindings with
  generated Swift counterpart). MS040.
- Phase 2: `@mobile-surfaces/tokens` package + adapter parse-on-entry. MS038,
  MS039.
- Phase 3: Reference app rebuild around a `DeliveryOrder` domain example with
  Diagnostics and Delivery screens.
- Phase 4: Versioning charter and CI gates. Linked group narrows to
  surface-contracts + validators + traps. MS041, MS042, MS043.
- Phase 5: Docs IA rewrite (README slim, new `adopt.md`, `stability.md`,
  `vs-expo-live-activity.md`, etc.).
- Phase 6: `npx mobile-surfaces audit <path>` subcommand.
- Phase 7: Native polish and test gaps.

TODO: expand this changeset with the full change list before final release.
