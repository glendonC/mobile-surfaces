# create-mobile-surfaces

Guided installer for [Mobile Surfaces](https://github.com/glendonC/mobile-surfaces), an Expo iOS starter for Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets.

## Usage

Pick the package manager you already have on PATH:

```bash
npm  create mobile-surfaces@latest
pnpm create mobile-surfaces
bun  create mobile-surfaces
```

The installer detects whether the current directory is empty (greenfield) or an existing Expo app (add-to-existing) and runs the matching flow.

### Scripted (non-interactive)

Pass `--yes` plus the required fields to skip every prompt. Useful for CI, AI agents, and `expect`-free automation:

```bash
npm create mobile-surfaces@latest --yes \
  --name my-app --bundle-id com.acme.myapp \
  --no-install
```

| Flag | Description |
|------|-------------|
| `--name <slug>` | Project name. Required with `--yes`. |
| `--scheme <scheme>` | URL scheme. Defaults to slugified project name. |
| `--bundle-id <id>` | iOS bundle id. **Required with `--yes`** because the default `com.example.<slug>` is rejected by Apple on upload. |
| `--team-id <id>` | Apple Team ID. Optional. |
| `--home-widget` / `--no-home-widget` | Include the home-screen widget surface (default: yes). |
| `--control-widget` / `--no-control-widget` | Include the iOS 18 control widget (default: yes). |
| `--install` / `--no-install` | Run `pnpm install` + `expo prebuild` after scaffold (default: yes). |
| `--yes`, `-y` | Non-interactive: accept defaults, skip the recap. |
| `--help`, `-h` | Show help. |

Run `npm create mobile-surfaces@latest --help` for the canonical reference.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success. |
| `1` | Error — bad flag value, missing `--name` with `--yes`, target dir not empty, install failure. |
| `2` | Cannot scaffold here — current dir is non-Expo and isn't empty. |

## What it does

**Greenfield**

1. Preflight: macOS, Node 24, Xcode 26+, an iOS 17.2+ simulator runtime, pnpm, and CocoaPods.
2. Prompts for project name, URL scheme, bundle identifier, Apple Team ID (optional), and whether to install + prebuild now.
3. Materializes the starter, runs the rename script, installs, and runs `expo prebuild --platform ios`.

**Add-to-existing Expo**

1. Detects the existing `app.json` / `app.config.{js,ts}`, plugins, deployment target, and Apple Team ID.
2. Plans which packages, plugins, Info.plist keys, and widget files to add. Surfaces a recap before any change is applied.
3. Patches `app.json` in place (or stages a paste-ready snippet for JS/TS configs), copies the SwiftUI widget target with names rewritten to your project's identity, and optionally runs `expo prebuild`.

## Requirements

- macOS with Xcode 26+
- Node 24
- pnpm 10+ for the greenfield flow (the template ships `pnpm-lock.yaml`); npm / yarn / bun work in add-to-existing
- An iOS 17.2+ simulator runtime
- CocoaPods (`gem install cocoapods` or `brew install cocoapods`)

## Links

- [Mobile Surfaces docs hub](https://github.com/glendonC/mobile-surfaces/blob/main/docs/README.md)
- [Architecture](https://github.com/glendonC/mobile-surfaces/blob/main/docs/architecture.md)
- [Backend integration](https://github.com/glendonC/mobile-surfaces/blob/main/docs/backend-integration.md)
- [Troubleshooting](https://github.com/glendonC/mobile-surfaces/blob/main/docs/troubleshooting.md)

## License

MIT
