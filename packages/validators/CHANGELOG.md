# @mobile-surfaces/validators

## 5.0.0

### Major Changes

- bc9ca80: v3 schema: rename `control.kind` to `control.controlKind`; sunset the v1 codec.

  The control slice's inner `kind` field shadowed the outer discriminator (`controlSnap.kind === "control"` vs `controlSnap.control.kind === "toggle"`) and was a hand-authoring footgun in raw payloads. v3 renames it to `controlKind` on the wire. The projection output (`liveSurfaceControlValueProvider`) already exposed `controlKind`, so consumers reading the projected value see no change.

  Migration:

  - Producers emitting control snapshots: rename `control.kind` to `control.controlKind` and bump `schemaVersion` to `"3"`.
  - Consumers using `safeParseAnyVersion`: v2 payloads keep working through the new v2 -> v3 codec; the result surfaces a `deprecationWarning` so telemetry can flag stragglers.
  - Consumers using strict `assertSnapshot`/`safeParseSnapshot`: v2 payloads fail. Migrate producers, or wrap with `safeParseAnyVersion`.
  - The v1 codec was sunset at 4.0 per the v2 RFC commitment. v1 producers must run through `@mobile-surfaces/surface-contracts@3` to migrate to v2 first.

  Schema URL bumps to `https://unpkg.com/@mobile-surfaces/surface-contracts@4.0/schema.json`.

## 3.2.0

### Minor Changes

- b6f4eb5: Retire `@mobile-surfaces/design-tokens`.

  The package was a 12-line re-export of a JSON file with one local consumer (the demo app's brand palette) and a single widget-config require for two hex values. It carried no contract, no Swift bytes, no schema — just cosmetic colors. The indirection earned nothing it cost: every release bumped a version that nobody else imported, snapshot tests pinned its presence in the scaffold, and the cohort of "@mobile-surfaces/\*" packages a foreign integrator audited for grew by one for no real value.

  Consumers: there are no published consumers we know of (no docs ever advertised direct use, and the package's exports were unused outside the demo app). If you do import `surfaceColors` / `swiftAssetColorMap` directly, copy the values from this commit's `apps/mobile/src/theme.ts` and inline them — they are 12 hex strings.

  The remaining packages co-version on the linked release group. The CLI's bundled template manifest drops the design-tokens row on the next `build:template` run.

## 3.1.1

### Patch Changes

- e582058: Audit follow-up hardening across the check scripts, CLI safety, and push SDK test coverage.

  The MS003 `check-activity-attributes` script now parses Swift `CodingKeys` and compares on JSON key rather than the Swift identifier, closing the silent class of failure where a `case headline = "title"` remap stayed byte-identical across both attribute files but broke ActivityKit decode. The parser handles auto-synthesized CodingKeys, raw-value remaps, multi-case declarations, partial enums (properties excluded from CodingKeys are flagged as never-serialized), and CodingKeys declared in a sibling extension.

  The `create-mobile-surfaces` add-to-existing apply now snapshots every file or directory it is about to touch and rolls back on any thrown error from the apply phase. A failed `pnpm add` or partial widget rewrite no longer leaves the user with a half-patched project. The backup directory is removed on commit and on rollback regardless of per-entry errors so a rerun starts clean.

  Adds subprocess-driven negative tests for `check-adapter-boundary`, `check-activity-attributes`, and `check-app-group-identity` (previously untested), and end-to-end coverage for the push SDK's expired-JWT retry path and broadcast/channel failure modes (`FeatureNotEnabled`, `ChannelNotRegistered`, `BadChannelId`, `CannotCreateChannelConfig`).

  No public API surface changed. Internal test seams in `packages/push/src/client.ts` are symbol-keyed (`TEST_TRANSPORT_OVERRIDE`) and cannot be reached from production callers.

## 3.1.0

### Minor Changes

- Lockstep release with the rest of the Mobile Surfaces linked group. No source changes in this package; the bump keeps `@mobile-surfaces/validators` aligned with the rest of the family at `3.1.0`.

## 3.0.0

### Major Changes

- Linked-group bump for the v2 schema release in `@mobile-surfaces/surface-contracts`. No behavior change in this package; the identity validators (`validateProjectSlug`, `validateScheme`, `validateBundleId`, `validateTeamId`, `validateSwiftIdentifier`, `toScheme`, `toBundleId`, `toSwiftPrefix`) are unchanged.

## 2.1.1

### Patch Changes

- 870f437: Publish `@mobile-surfaces/validators` to npm for the first time. The package was extracted out of `create-mobile-surfaces` and `scripts/rename-starter.mjs` in an earlier commit, but the publish-pipeline plumbing (linked group membership, trusted-publisher configuration on npm, docs/release.md package list) was incomplete. The `Pack-and-install smoke` CI step fails on every PR until validators is on npm, because `pnpm pack` rewrites the CLI's `workspace:*` dep to a concrete `2.1.0` version that npm cannot resolve.

  Add `@mobile-surfaces/validators` to the linked release group so it versions in lockstep with the rest of the public Mobile Surfaces packages.
