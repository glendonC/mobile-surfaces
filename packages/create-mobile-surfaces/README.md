# create-mobile-surfaces

Guided installer for [Mobile Surfaces](https://github.com/glendonC/mobile-surfaces), an opinionated Expo iOS starter for Live Activities and Dynamic Island workflows.

## Usage

Pick the package manager you already have on PATH:

```bash
npm  create mobile-surfaces@latest
pnpm create mobile-surfaces
bun  create mobile-surfaces
```

The installer detects whether the current directory is empty (greenfield) or an existing Expo app (add-to-existing) and runs the matching flow.

## What it does

**Greenfield**

1. Preflight: macOS, Node 24, Xcode 16+, an iOS 16.2+ simulator runtime, pnpm, and CocoaPods.
2. Prompts for project name, URL scheme, bundle identifier, Apple Team ID (optional), and whether to install + prebuild now.
3. Materializes the starter, runs the rename script, installs, and runs `expo prebuild --platform ios`.

**Add-to-existing Expo**

1. Detects the existing `app.json` / `app.config.{js,ts}`, plugins, deployment target, and Apple Team ID.
2. Plans which packages, plugins, Info.plist keys, and widget files to add — surfaces a recap before any change is applied.
3. Patches `app.json` in place (or stages a paste-ready snippet for JS/TS configs), copies the SwiftUI widget target with names rewritten to your project's identity, and optionally runs `expo prebuild`.

## Requirements

- macOS with Xcode 16+
- Node 24
- pnpm 10+ for the greenfield flow (the template ships `pnpm-lock.yaml`); npm / yarn / bun work in add-to-existing
- An iOS 16.2+ simulator runtime
- CocoaPods (`gem install cocoapods` or `brew install cocoapods`)

## Links

- [Mobile Surfaces docs](https://github.com/glendonC/mobile-surfaces#readme)
- [Architecture](https://github.com/glendonC/mobile-surfaces/blob/main/docs/architecture.md)
- [Backend integration](https://github.com/glendonC/mobile-surfaces/blob/main/docs/backend-integration.md)
- [Troubleshooting](https://github.com/glendonC/mobile-surfaces/blob/main/docs/troubleshooting.md)

## License

MIT
