# Release

Mobile Surfaces publishes npm packages from GitHub Actions using npm trusted publishing. Do not store an npm token in the repository.

The release flow is Changesets-based:

1. Feature work lands with one or more `.changeset/*.md` files.
2. A push to `main` runs the `Publish` workflow.
3. If pending changesets exist, the workflow opens or updates a `Version packages` PR.
4. Merging that PR commits version bumps and changelogs.
5. The next `Publish` workflow run publishes those committed versions to npm.

## One-time npm setup

Configure trusted publishing on npm for each published package:

- `create-mobile-surfaces`
- `@mobile-surfaces/surface-contracts`
- `@mobile-surfaces/design-tokens`
- `@mobile-surfaces/live-activity`
- `@mobile-surfaces/push`

Use these trusted publisher settings:

- Repository owner: `glendonC`
- Repository name: `mobile-surfaces`
- Workflow filename: `publish.yml`

When adding a new package, create/configure the npm package before the first release. A 404 during publish usually means npm trusted publishing is not configured for that package name yet.

## Release Flow

### 1. Add changesets with feature work

Each user-visible package change should include a changeset:

```bash
pnpm changeset
```

Choose the packages affected by the change and the correct semver level. The linked release group in `.changeset/config.json` keeps the public Mobile Surfaces packages versioned together when any linked package changes.

### 2. Merge to `main`

CI and the `Publish` workflow run on every push to `main`. The `Publish` workflow first runs the release checks (`surface:check`, `typecheck`, script tests, push tests, CLI tests, existing-app smoke).

### 3. Review the `Version packages` PR

If pending changesets exist, `changesets/action` opens or updates a `Version packages` PR. Review the package versions and changelogs, then merge it when ready to release.

Do not run `pnpm changeset version` manually for the normal flow; the action owns the version commit.

### 4. Publish

After the version PR merges, the `Publish` workflow runs again. With no pending changesets left, it publishes any local package version that npm does not have yet.

The workflow publishes with npm provenance through OIDC (`id-token: write`). It should not need `NPM_TOKEN`.

## Partial Publish Recovery

If npm publishes some packages and rejects one package, fix the rejected package and rerun the `Publish` workflow from `main`. Changesets checks npm first and only attempts unpublished versions, so reruns are safe.

Common cause:

- `E404 Not Found - PUT https://registry.npmjs.org/@scope%2fname`: the package does not exist yet or trusted publishing is not configured for that package name.

For `@mobile-surfaces/push`, configure npm trusted publishing with the same `publish.yml` settings, then rerun `Publish`.

## Verify

After the workflow succeeds:

```bash
npm view create-mobile-surfaces version
npm view @mobile-surfaces/surface-contracts version
npm view @mobile-surfaces/design-tokens version
npm view @mobile-surfaces/live-activity version
npm view @mobile-surfaces/push version
```

Prefer `npm view` over the npm website immediately after publishing. The website can cache package pages and show an old version or README for a while even when the registry API and install resolution already point at the new version.
