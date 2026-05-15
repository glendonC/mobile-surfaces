---
"@mobile-surfaces/surface-contracts": major
"@mobile-surfaces/live-activity": major
"@mobile-surfaces/push": major
"@mobile-surfaces/validators": major
"create-mobile-surfaces": major
---

v3 schema: rename `control.kind` to `control.controlKind`; sunset the v1 codec.

The control slice's inner `kind` field shadowed the outer discriminator (`controlSnap.kind === "control"` vs `controlSnap.control.kind === "toggle"`) and was a hand-authoring footgun in raw payloads. v3 renames it to `controlKind` on the wire. The projection output (`liveSurfaceControlValueProvider`) already exposed `controlKind`, so consumers reading the projected value see no change.

Migration:

- Producers emitting control snapshots: rename `control.kind` to `control.controlKind` and bump `schemaVersion` to `"3"`.
- Consumers using `safeParseAnyVersion`: v2 payloads keep working through the new v2 -> v3 codec; the result surfaces a `deprecationWarning` so telemetry can flag stragglers.
- Consumers using strict `assertSnapshot`/`safeParseSnapshot`: v2 payloads fail. Migrate producers, or wrap with `safeParseAnyVersion`.
- The v1 codec was sunset at 4.0 per the v2 RFC commitment. v1 producers must run through `@mobile-surfaces/surface-contracts@3` to migrate to v2 first.

Schema URL bumps to `https://unpkg.com/@mobile-surfaces/surface-contracts@4.0/schema.json`.
