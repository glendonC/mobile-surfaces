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
| `--new-arch` / `--no-new-arch` | Force Expo's New Architecture on or off. Omit to keep the template default. |
| `--yes`, `-y` | Non-interactive: accept defaults, skip the recap. |
| `--help`, `-h` | Show help. |

Run `npm create mobile-surfaces@latest --help` for the canonical reference.

### CI / GitHub Actions

A typical CI step that scaffolds and verifies a clean install. The CLI exits non-zero on any failure path, so the workflow stops early without needing custom branching:

```yaml
- name: Scaffold Mobile Surfaces
  run: |
    npm create mobile-surfaces@latest --yes \
      --name my-app --bundle-id com.acme.myapp \
      --no-install
- name: Install + prepare iOS
  run: cd my-app && pnpm install && pnpm mobile:prebuild:ios
```

If you want to branch on cause, use the canonical [exit codes](#exit-codes) — `1` is user-error (bad inputs), `2` is environment-error (missing tools, install failed), `3` is a packaging issue with the CLI itself.

### Exit codes

CI consumers can branch on these. The categories are coarse so adding a new failure path doesn't change the contract.

| Code | Meaning |
|------|---------|
| `0` | Success — also returned for `--help`, `EPIPE`, and prompts the user explicitly cancelled. |
| `1` | User-error — bad flag value, target dir not empty, `--yes` missing a required value, or the cwd is one we can't scaffold into (non-Expo with files, or `apps/mobile/` already exists). |
| `2` | Environment-error — preflight failed, `pnpm`/CocoaPods missing on `PATH`, install failed, prebuild failed, or the apply phase threw. The fix is in your environment. |
| `3` | Template-error — the bundled template tarball or manifest is missing or unreadable. The published CLI is broken; please file an issue. |
| `130` | Interrupted — Ctrl+C / `SIGINT` during a task. POSIX convention (128 + SIGINT). |

Breaking change in v1.4: refuse paths (cannot-scaffold-here) used to exit `2`. They now exit `1` so the contract reads `1=user, 2=env, 3=template`. Any CI that checked for `2` to detect "wrong directory" should update.

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
