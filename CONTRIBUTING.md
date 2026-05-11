# Contributing

Thanks for helping improve Mobile Surfaces. By participating you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

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
