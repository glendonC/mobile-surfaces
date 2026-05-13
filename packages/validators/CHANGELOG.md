# @mobile-surfaces/validators

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
