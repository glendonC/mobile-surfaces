# Roadmap

Mobile Surfaces v0 stays focused: create a runnable Expo iOS starter for Live Activity, Dynamic Island, home-screen widget, and iOS 18 control widget workflows, with app UI, alert pushes, deterministic fixtures, and local validation commands.

## V0

- Keep Expo / React Native as the app shell.
- Keep iOS as the only supported native platform.
- Use Expo dev client, not Expo Go.
- Use the local ActivityKit module plus `@bacons/apple-targets` for the WidgetKit extension.
- Share widget/control state through App Groups.
- Keep fixtures deterministic and app-agnostic.
- Keep scripts focused on local setup, doctor checks, surface validation, simulator push, and APNs smoke tests.

## Future CLI Post-V0

Package name:

```text
create-mobile-surfaces
```

Command UX:

```bash
npm create mobile-surfaces@latest
pnpm create mobile-surfaces
bun create mobile-surfaces
```

The package would follow npm create conventions: publish a `create-mobile-surfaces` package with a bin entry, then scaffold or patch based on detected repo state.

## Create Mode First

The first CLI should create a new starter repo from this template. That means:

- Copy the Expo app, packages, fixtures, scripts, and docs.
- Prompt for app name, URL scheme, bundle id, and widget target name.
- Install dependencies with the user's package manager.
- Run `surface:check` and print next steps for `mobile:prebuild:ios`.

## Add-To-Existing Later

The CLI can later infer:

- Empty repo: create a full Mobile Surfaces starter.
- Existing Expo app: add packages, WidgetKit target, App Group entitlements, local module or adapter, fixtures, scripts, and docs.
- Existing non-mobile monorepo: create `apps/mobile` and wire workspace packages.

Do not overbuild this in v0. Existing app layouts vary too much for a universal patcher to be reliable without more real-world examples.

## Adapter Experiments

Future branches can test:

- `software-mansion-labs/expo-live-activity` as a dependency-backed ActivityKit bridge.
- `expo-widgets` once its alpha APIs and Live Activity rendering path stabilize.
- Separate adapters for local module, `expo-live-activity`, and `expo-widgets` behind the same JS harness API.

The `LiveSurfaceSnapshot` contract should stay stable across those experiments.
