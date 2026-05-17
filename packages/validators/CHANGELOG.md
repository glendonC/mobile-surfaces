# @mobile-surfaces/validators

## 8.0.0

### Major Changes

- c347e54: v3 codec retirement. Per the versioning charter, a deprecated codec lives for at least one major past the release that deprecated it; v3 was first deprecated at 5.0 and ages out at 8.0.

  surface-contracts drops `liveSurfaceSnapshotV3`, `migrateV3ToV4`, `LiveSurfaceSnapshotV3`, the `V3_DEPRECATION_WARNING` constant, and the v3 branch in `safeParseAnyVersion`. The codec chain narrows to v5 → v4. The v4 codec's deprecation prose moves from "removed in 8.0.0" to "removed in 9.0.0" so the MS042 gate stays satisfied.

  Consumers with v3 payloads at rest must pin `@mobile-surfaces/surface-contracts@7.x` once, run `safeParseAnyVersion` to promote v3 → v5, store the result, then upgrade.

  `schemaVersion` stays at `"5"`. This release is codec retirement, not a wire-format bump.

  `@mobile-surfaces/validators` and `@mobile-surfaces/traps` cut majors in lockstep per the linked release group with no API change of their own.

  `@mobile-surfaces/push`, `@mobile-surfaces/live-activity`, `@mobile-surfaces/tokens`, and `create-mobile-surfaces` cut minors for the linked dependency range update; no API change.

### Patch Changes

- Updated dependencies [c347e54]
  - @mobile-surfaces/traps@8.0.0

## 7.0.0

### Major Changes

- Coordinated v7 release across the Mobile Surfaces packages. `@mobile-surfaces/validators` remains in the linked release group with `@mobile-surfaces/surface-contracts` and `@mobile-surfaces/traps`; the three packages cut a coordinated major when the wire-format contract or trap catalog shifts.

- Validator error classes that map to a trap catalog entry now extend `MobileSurfacesError` from `@mobile-surfaces/traps` and carry `trapId` + `docsUrl` getters.

## 6.0.0

### Major Changes

- Linked-group bump for the v5 schema release in `@mobile-surfaces/surface-contracts`. No validator API change.

## 5.0.0

### Major Changes

- Linked-group bump for the v4 schema release in `@mobile-surfaces/surface-contracts`. `@mobile-surfaces/validators` has no API change in this release; the linked group cuts a coordinated major when `surface-contracts` ships a wire-format schema bump (here, v4: rendering fields move into per-kind slices, `schemaVersion` required without default, v2 codec dropped). Consumers can update lockfiles without code changes specific to this package; the new package README documents the validator surface for foreign auditors.

## 4.0.0

### Major Changes

- Linked-group bump for the v3 schema release in `@mobile-surfaces/surface-contracts`. No validator API change.

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
