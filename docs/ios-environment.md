# iOS Environment

Mobile Surfaces is an Expo iOS dev-client starter for ActivityKit-backed Live Activity, Dynamic Island, home-screen widget, and iOS 18 control widget workflows.

In plain English: Expo Go is not enough because these surfaces need real native iOS code. Use a development build while building locally, then TestFlight or App Store builds for production-style testing. The current pinned toolchain row (Expo SDK 55, RN 0.83.6, iOS 17.2, Xcode 26) lives in [`docs/compatibility.md`](./compatibility.md).

## Native Pieces

1. Main app: `apps/mobile/`, bundle id `com.example.mobilesurfaces`.
2. Widget extension: `apps/mobile/targets/widget/`, generated into Xcode by `@bacons/apple-targets`; it contains the Live Activity, home-screen widget, and iOS 18 control widget.
3. Expo native module: `packages/live-activity/` (`@mobile-surfaces/live-activity`), wrapping `Activity<MobileSurfacesActivityAttributes>.request`, update, list, end, push token events, and activity state events.

The Swift attribute type is intentionally duplicated in the module and widget target. Keep these files byte-identical:

- `packages/live-activity/ios/MobileSurfacesActivityAttributes.swift`
- `apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift`

`pnpm surface:check` verifies this.

Widget and control snapshots are shared through the App Group in `apps/mobile/app.json`:

```json
"com.apple.security.application-groups": ["group.com.example.mobilesurfaces"]
```

The widget target copies that same entitlement from `apps/mobile/targets/widget/expo-target.config.js`. If you rename the bundle id, keep the App Group aligned.

## Commands

```bash
pnpm dev:setup                        # verify toolchain and install dependencies
pnpm dev:doctor                       # verify Node, pnpm, Xcode, and simulator availability
pnpm surface:check                    # validate fixtures and ActivityKit attribute drift
pnpm typecheck                        # TypeScript check
pnpm mobile:sim                       # build/install dev app to the default simulator
pnpm mobile:dev-client                # start Metro for the dev-client build
pnpm mobile:prebuild:ios              # regenerate apps/mobile/ios
pnpm mobile:run:ios                   # build/install to simulator
pnpm mobile:run:ios:device            # build/install to a connected iPhone
pnpm mobile:push:sim                  # simctl push smoke payload
pnpm mobile:push:device:alert         # APNs alert push, requires APNS_* env vars and --snapshot-file
pnpm mobile:push:device:liveactivity  # ActivityKit push update/end, requires an activity token
```

`pnpm mobile:sim` defaults to `iPhone 17 Pro`. Override with:

```bash
DEVICE="iPhone 17 Pro Max" pnpm mobile:sim
```

The default simulator name tracks the current development environment. If Xcode changes simulator names, set `DEVICE` to any available simulator from `xcrun simctl list devices available`.

## Apple Team ID

`apps/mobile/app.json` ships with `expo.ios.appleTeamId` set to the placeholder `XXXXXXXXXX`. Replace it with your 10-character team id before running `pnpm mobile:run:ios:device` or any signed build; otherwise the generated Xcode project will fail to sign and `expo run:ios --device` will error out on first launch. Find your team id in Xcode → Signing & Capabilities → Team, or at [developer.apple.com](https://developer.apple.com/account) → Membership.

`pnpm dev:doctor` warns when the placeholder is still present.

## Generated iOS Policy

`apps/mobile/ios/` is intentionally ignored. Regenerate it with Expo prebuild:

```bash
pnpm mobile:prebuild:ios
```

The committed native sources of truth are:

- `apps/mobile/app.json`
- `packages/live-activity/`
- `apps/mobile/targets/widget/`

This keeps the repo reviewable and avoids committing generated Xcode churn.

Expo SDK 55 makes the New Architecture mandatory; `newArchEnabled` is no longer a togglable `app.json` option. The local ActivityKit bridge runs on the new arch by default.

## Testing Matrix

| Capability | Expo Go | Dev build simulator | Dev build device |
| --- | ---: | ---: | ---: |
| React Native harness UI | Partial | Yes | Yes |
| Local native module | No | Yes | Yes |
| Simulated alert push | No | Yes | No |
| Real APNs alert | No | No | Yes |
| Live Activity local start/update/end | No | Limited | Yes |
| Home-screen widget shared state | No | Yes | Yes |
| iOS 18 control widget shared state | No | iOS 18+ runtime | iOS 18+ device |
| Dynamic Island | No | No | iPhone 14 Pro or newer |
| ActivityKit push update/end | No | No | Yes |

## Device Live Activity Loop

1. Run `pnpm mobile:run:ios:device` on a physical iPhone.
2. Open Mobile Surfaces and confirm "Activities supported" shows `yes`.
3. Tap a generic Start fixture in the harness, such as `queued` or `active`.
4. Lock the phone and verify the Lock Screen Live Activity.
5. On a Dynamic Island-capable iPhone, verify compact, expanded, and minimal presentations.
6. Tap update and end controls in the harness.
7. Copy the activity push token and run an APNs Live Activity update:

```bash
pnpm mobile:push:device:liveactivity -- \
  --activity-token=<paste> \
  --event=update \
  --state-file=./scripts/sample-state.json \
  --env=development
```

## APNs Environment

Create an APNs auth key in the Apple Developer portal and store it outside the repo, for example:

```bash
mkdir -p ~/.mobile-surfaces
mv ~/Downloads/AuthKey_*.p8 ~/.mobile-surfaces/
chmod 600 ~/.mobile-surfaces/AuthKey_*.p8
```

Set:

```bash
export APNS_KEY_PATH="$HOME/.mobile-surfaces/AuthKey_XXXXXXXXXX.p8"
export APNS_KEY_ID="XXXXXXXXXX"
export APNS_TEAM_ID="XXXXXXXXXX"
export APNS_BUNDLE_ID="com.example.mobilesurfaces"
```

Use `--env=development` for dev builds and `--env=production` for TestFlight/App Store builds.
