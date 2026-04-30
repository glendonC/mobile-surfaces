# Release

Mobile Surfaces publishes npm packages from GitHub Actions using npm trusted publishing. Do not store an npm token in the repository.

## One-time npm setup

Configure trusted publishing on npm for each published package:

- `create-mobile-surfaces`
- `@mobile-surfaces/surface-contracts`
- `@mobile-surfaces/design-tokens`
- `@mobile-surfaces/live-activity`

Use these trusted publisher settings:

- Repository owner: `glendonC`
- Repository name: `mobile-surfaces`
- Workflow filename: `publish.yml`

## Release flow

1. Merge the release changes to `main`.
2. Run Changesets versioning locally or in a release branch:

```bash
pnpm changeset version
pnpm install
pnpm surface:check
pnpm typecheck
pnpm test:scripts
pnpm cli:test
pnpm cli:smoke:existing
```

3. Commit and push the version bump:

```bash
git add .
git commit -m "Release Mobile Surfaces <version>"
git push origin main
```

4. In GitHub, run the `Publish` workflow from `main`.

The workflow installs dependencies, reruns the release checks, and publishes packages with npm provenance through OIDC.

## Verify

After the workflow succeeds:

```bash
npm view create-mobile-surfaces version
npm view @mobile-surfaces/surface-contracts version
npm view @mobile-surfaces/design-tokens version
npm view @mobile-surfaces/live-activity version
```
