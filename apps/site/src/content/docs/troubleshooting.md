---
title: "Troubleshooting"
description: "Symptom-to-fix recipes for silent iOS failures."
order: 90
group: "Operate"
---
# Troubleshooting

Symptoms and fixes for the most common Mobile Surfaces dev-loop snags. Run `pnpm dev:doctor` first; it covers Node, pnpm, Xcode, the default simulator, and the Apple Team ID placeholder.

For production-traffic failure modes (which catalog-bound errors are worth alerting on, what a stuck Live Activity looks like on the wire, recommended hook log shape), see [`docs/observability.md`](/docs/observability).

## "Activities supported: no" in the harness

The harness reads `Activity<…>.activityAuthorizationInfo().areActivitiesEnabled`. iOS reports `false` when:

- The user has Live Activities turned off for this app. Open iOS Settings → your app's name → Live Activities and toggle it on.
- The user has Live Activities turned off globally. Open iOS Settings → Notifications → Live Activities and toggle the global switch on. There is a second toggle at Settings → Face ID & Passcode → Allow Access When Locked → Live Activities that controls Lock-Screen rendering specifically; flip both on if Lock-Screen activities are missing.
- The build is still running on Expo Go. Live Activities require a development build; run `pnpm mobile:sim` or `pnpm mobile:run:ios:device`.
- The deployment target dropped below the project floor. Confirm `apps/mobile/app.json` still has `expo.ios.deploymentTarget: "17.2"` and the `expo-build-properties` plugin block sets the same.

If all of the above check out, fully delete the app from the device or simulator and reinstall. iOS caches the entitlement decision per install.

## Lock Screen Live Activity is not visible on the simulator

Simulator support for Live Activities is partial.

- Compact and minimal Dynamic Island regions render only on iPhone 14 Pro / 15 Pro / 16 Pro / 17 Pro and newer simulators. On non-Pro simulators, only the Lock Screen surface is exercised.
- Some Xcode versions ship simulator runtimes whose Lock Screen presentation does not render Live Activities at all. Use a physical device when you need confidence in the Lock Screen layout.
- The Lock Screen surface shows up only when the device is locked. In the simulator, lock with `Device → Lock` (`⌘L`). The Dynamic Island shows on the live (unlocked) Home Screen on Pro models.
- If you started the activity but the Lock Screen is empty, the widget extension probably failed to embed. Run `pnpm mobile:prebuild:ios --clean` and rebuild; check that `apps/mobile/targets/widget/` files are present in the generated Xcode project.

## Dynamic Island is missing

- Confirm the simulator model is iPhone 14 Pro or newer (compact and minimal regions only render on Dynamic Island-capable hardware).
- The expanded layout shows when the activity is invoked from a long press. Compact appears next to the camera; minimal shows when another activity is also active.
- If only the Lock Screen presentation works, the widget bundle compiled but the `DynamicIsland` block in `apps/mobile/targets/widget/MobileSurfacesLiveActivity.swift` may be unreachable. Check `pnpm surface:check`, which verifies the `MobileSurfacesActivityAttributes.swift` files are byte-identical, which is the most common silent break.

## Home widget or control widget shows placeholder state

The home widget and iOS 18 control widget read projected snapshots from App Group `UserDefaults`.

- Confirm `pnpm dev:doctor` prints an App Group value.
- Confirm `apps/mobile/app.json` and `apps/mobile/targets/widget/expo-target.config.js` use the same `com.apple.security.application-groups` value.
- Tap the harness `refresh widget` or `toggle control` button after reinstalling the dev build. WidgetKit and Control Center cache state, so old installs can keep stale entitlements.
- If the home widget still shows placeholder copy, delete the app from the simulator/device and run `pnpm mobile:sim` again. Entitlement changes are install-time sensitive.
- Control widgets require iOS 18 or newer. On older runtimes the control widget will not be available even though the app build can still succeed.

## APNs returns 403

The APNs response body carries the actual reason. `pnpm mobile:push:device:liveactivity` and `…:alert` print it as `Body: {"reason":"…"}`.

- `BadDeviceToken`: token environment / endpoint mismatch. Use `--env=development` for dev-client and `expo run:ios` builds; `--env=production` only for TestFlight and App Store builds. Tokens from one environment never authenticate against the other.
- `InvalidProviderToken`: the JWT is rejected. Confirm `APNS_KEY_ID` (10 chars), `APNS_TEAM_ID` (10 chars), and the `.p8` at `APNS_KEY_PATH` all match the same APNs auth key in the Apple Developer portal. JWTs are also rejected when the local clock is more than ~1 hour off; sync system time.
- `TopicDisallowed`: the auth key is not enabled for this bundle id, or `APNS_BUNDLE_ID` does not match `apps/mobile/app.json`'s `expo.ios.bundleIdentifier`. For Live Activity pushes the topic is automatically suffixed with `.push-type.liveactivity`; that suffix is not part of `APNS_BUNDLE_ID` itself.
- `Forbidden` with no reason: the auth key was revoked. Generate a new one in the Apple Developer portal.

## APNs returns 400

- `BadPriority`: priority is not `5` or `10`. Use `--priority=5` or `--priority=10` (the default for Live Activity is `5`).
- `BadExpirationDate` / `BadDate`: `--stale-date` or `--dismissal-date` is not a positive unix-seconds integer. The script validates these, so if you see the APNs error, the value reached APNs through some other path.
- `MissingTopic` or `TopicDisallowed`: see the 403 entry above.

## A Live Activity push returns 200 but nothing changes on device

- Apple budgets Live Activity push delivery aggressively. The default priority is `5` for that reason. Burst many `--priority=10` pushes in a row and iOS will silently drop subsequent ones for the rest of the budget window.
- The activity ended (locally or via a previous push). `pnpm mobile:push:device:liveactivity --event=update` against a finished activity is accepted by APNs and dropped by iOS. Check the harness "All active activities" list.
- The `--state-file` JSON's keys do not match the Swift `MobileSurfacesActivityAttributes.ContentState` shape (`headline`, `subhead`, `progress`, `stage`). ActivityKit silently drops malformed updates.
- The push token is stale. Each Live Activity gets a fresh token via `Activity.pushTokenUpdates`; copying an old one from a prior session will not work.

## Stale Watchman, Metro, or Expo state

When the harness UI does not reflect a code change, or the build links the wrong widget bundle:

```bash
watchman watch-del-all
rm -rf apps/mobile/.expo apps/mobile/node_modules/.cache
pnpm install
pnpm mobile:prebuild:ios --clean
pnpm mobile:sim
```

The `.expo` cache and the prebuild output are the most common culprits. `--clean` forces `expo prebuild` to discard `apps/mobile/ios/` and regenerate from `app.json` plus committed sources.

## Engine warning during pnpm install

```
WARN  Unsupported engine: wanted: {"node":">=24.0.0 <25"} (current: {"node":"vXX.X.X","pnpm":"…"})
```

The repo pins Node 24 in `engines`. Older versions still install; newer majors may break Expo SDK 55. Use `nvm install 24` or `fnm use 24` to silence.

## Duplicate `-lc++` warning during prebuild

```
ld: warning: ignoring duplicate libraries: '-lc++'
```

This is a known Xcode / React Native linker warning at the time of writing. The build still succeeds. No action required.
