# Contributing

Thanks for helping improve Mobile Surfaces.

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

## Native Workflow

`apps/mobile/ios/` is generated and ignored. Update these committed sources instead:

- `apps/mobile/app.json`
- `apps/mobile/modules/live-activity/`
- `apps/mobile/targets/widget/`

Then regenerate with:

```bash
pnpm mobile:prebuild:ios
```
