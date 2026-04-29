# Contributing

Thanks for helping improve Mobile Surfaces. By participating you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Two-Consumer Rule

Do not add a new abstraction (helper, type, contract field, adapter slot, config knob) until two real call sites in this repo need it. One consumer is a special case; two is a pattern. This rule is the main way Mobile Surfaces resists starter rot — most "wouldn't it be cleaner if…" PRs should be deferred until a second consumer materializes.

## Local Checks

Run these before opening a pull request:

```bash
pnpm dev:setup
pnpm surface:check
pnpm typecheck
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

## Native Workflow

`apps/mobile/ios/` is generated and ignored. Update these committed sources instead:

- `apps/mobile/app.json`
- `apps/mobile/modules/live-activity/`
- `apps/mobile/targets/widget/`

Then regenerate with:

```bash
pnpm mobile:prebuild:ios
```
