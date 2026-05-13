# @mobile-surfaces/validators

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
