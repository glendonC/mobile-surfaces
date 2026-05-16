# Contributing

Thanks for helping improve Mobile Surfaces. By participating you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Branch and Release Workflow

Never push to `main` directly. The repo runs a Changesets release flow: merging to `main` triggers a `Version packages` PR that the bot auto-merges and then `publish.yml` runs `npm publish` against a fixed-version snapshot. A direct push to `main` races that bot and produces the diverged-history class of bug — the recovery is a non-trivial rebase resolving edit-delete conflicts against freshly bumped CHANGELOGs.

The flow for every change, large or small:

1. **Branch off `main`** — `git checkout -b <topic>`. No work happens on `main` ever, including doc fixes and changeset additions.
2. **Make the change**, including any `changeset` entry that the change requires. Run `pnpm changeset` for any user-facing change to a published package. Doc-only edits and internal tooling do not need a changeset.
3. **Run `pnpm release:dry-run` locally before pushing.** It runs every gate CI runs (`surface:check`, full test suite, scaffold snapshot, site build, typecheck) plus the regen-drift check. If anything fails, `pnpm release:fix` regenerates the derived files (`CLAUDE.md`/`AGENTS.md`, trap-bindings, traps-data, JSON schema, surface fixtures, scaffold snapshots). Commit the regen, re-run dry-run.
4. **Open a PR** via `gh pr create` or the GitHub UI. CI runs the same chain dry-run did. Wait for green.
5. **Merge the PR.** Squash-merge is fine for a single-commit change; merge-commit preserves more provenance for multi-commit work.
6. **Wait for the Changesets `Version packages` PR** to appear (within ~1 minute of the merge to `main`). It rolls up every pending changeset into version bumps and CHANGELOG entries. Inspect the diff; if it looks right, merge it.
7. **Watch `publish.yml`** fire on the release commit. It runs the trusted-publisher OIDC flow and pushes new versions to npm. Verify with `npm view @mobile-surfaces/<pkg> version`.

Cherry-picking commits between branches is forbidden in normal flow. Cherry-picks lose the regen step (every recent "regenerate X after cherry-pick" commit in `git log` is a symptom). When you need work from one branch on another, rebase or merge — never cherry-pick — and run `pnpm release:fix` on the receiving side.

`pnpm setup:hooks` installs an opt-in `pre-push` hook that enforces the rules locally: refuses non-fast-forward pushes, refuses direct-to-`main` pushes, and runs `pnpm release:dry-run` before the push completes. Run it once on every clone you work from.

## Trap Catalog Numbering

Trap ids in `data/traps.json` (`MS001`, `MS002`, …) are monotonic forever. They leak into permanent artifacts — PR comments, log lines, AGENTS.md and CLAUDE.md, external blog posts — so reusing an id silently flips its meaning for every existing reference.

Rules:

1. New rules get the next free numeric id (highest existing `+ 1`). Do not fill gaps.
2. Retiring a rule keeps its entry in the catalog with `deprecated: true`, `detection: "advisory"`, and prose that explains what happened (merged into another rule, removed without history). The id stays reserved.
3. Hard-deleting an entry is forbidden. If a rule was deleted before this policy was written and its history is unrecoverable, leave a deprecated stub at the next regen with `summary: "Reserved id..."` so the rendered catalog shows the gap is intentional.

The MS-numbered ids and their `since` versions are part of the contract package's public surface. Treat them with the same stability discipline as a Zod schema field.

## Two-Consumer Rule

Do not add a new abstraction (helper, type, contract field, adapter slot, config knob) until two real call sites in this repo need it. One consumer is a special case; two is a pattern. This rule is the main way Mobile Surfaces resists starter rot — most "wouldn't it be cleaner if…" PRs should be deferred until a second consumer materializes.

"Real consumer" means an actual call site in this repo: the harness (`apps/mobile/`), the contract package (`packages/surface-contracts/`), the live-activity bridge (`packages/live-activity/`), the **push SDK (`packages/push/`)**, the CLI (`packages/create-mobile-surfaces/`), or a checked-in script / fixture / test. The push SDK is third-party-facing — it ships to npm as `@mobile-surfaces/push` — so the rule applies with extra weight to its public surface: when adding a field, error class, or method, hold the change until two real callers need it (the smoke script in `scripts/send-apns.mjs` plus at least one real backend consumer or test fixture). One consumer is a special case; two is a pattern; "future user" is not a consumer.

## Local Checks

Run these before opening a pull request:

```bash
pnpm dev:setup
pnpm surface:check
pnpm typecheck
pnpm test:push
```

Use an Expo development build for native testing. Expo Go cannot exercise the local ActivityKit module, WidgetKit target, APNs behavior, or Dynamic Island surfaces.

## Fixture Workflow

JSON fixtures in `data/surface-fixtures/` are the source of truth. After editing them, run:

```bash
node scripts/generate-surface-fixtures.mjs
pnpm surface:check
```

Do not hand-edit `packages/surface-contracts/src/fixtures.ts`; it is generated.

`fixtures.ts` is generated and committed on purpose. Keeping it in source means a fresh clone has working TypeScript before any install or build step runs, no `postinstall` hook is needed, and CI catches drift via `pnpm surface:check` (`generate-surface-fixtures.mjs --check`) rather than regenerating silently. The tradeoff is that fixture-touching PRs include both the JSON change in `data/surface-fixtures/` and the regenerated `fixtures.ts` diff — review them as a pair.

## Dependency Pinning

Different layers of this repo follow different pinning rules. The rules are not arbitrary; each one is the one that keeps that layer's tooling honest.

- **Published packages** (`packages/*` other than `apps/`) pin every dependency to an exact version. Consumers install transitively and have no lockfile of ours to fall back on, so a floating range there would silently shift downstream builds.
- **`apps/mobile`** follows Expo's template convention: tilde ranges (`~55.0.18`) on `expo` and `expo-*`, exact on `react`, `react-dom`, `react-native`, `@bacons/apple-targets`. Expo curates compatible patch ranges via `bundledNativeModules.json`; rewriting these to exact pins makes `expo install --check` and `expo-doctor` noisy without changing what the lockfile actually installs.
- **`apps/site`** (private marketing site) uses caret/tilde ranges per the upstream Astro/Tailwind conventions. CI runs `pnpm install --frozen-lockfile`, so the lockfile is the source of truth either way.

`@bacons/apple-targets` is the one Expo-adjacent dep that must stay exact-pinned (MS026): it materializes the widget Xcode target at prebuild time, and a floating range there would shift the generated `ios/` output across contributors. `scripts/check-external-pins.mjs` enforces this in CI; bump it through a changeset like any other published dep.

## Native Workflow

`apps/mobile/ios/` is generated and ignored. Update these committed sources instead:

- `apps/mobile/app.json`
- `packages/live-activity/`
- `apps/mobile/targets/widget/`

Then regenerate with:

```bash
pnpm mobile:prebuild:ios
```
