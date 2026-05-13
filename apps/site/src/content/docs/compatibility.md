---
title: "Compatibility"
description: "Pinned Expo SDK, React Native, iOS, Xcode, and @bacons/apple-targets row."
order: 70
---
# Compatibility

Mobile Surfaces pins to a single tested toolchain row. Treat any cell change as an upgrade ritual: bump deliberately, run `pnpm surface:check && pnpm typecheck && pnpm dev:doctor && pnpm mobile:prebuild:ios` on a fresh clone, and update this row in the same PR.

| Expo SDK | React Native | React | iOS minimum | Xcode | `@bacons/apple-targets` |
| --- | --- | --- | --- | --- | --- |
| 55 | 0.83.6 | 19.2.0 | 17.2 | 26 | 4.0.6 |

Notes:

- `expo-build-properties` follows Expo SDK majors and is pinned to the SDK 55 line.
- `@bacons/apple-targets` is pinned to an exact patch because the author publishes from `main` without release tags; floating ranges have shipped breaking changes.
- The Expo SDK 55 floor for iOS is 15.1, but Mobile Surfaces deliberately targets **17.2** so push-to-start tokens (`Activity<…>.pushToStartTokenUpdates`) are available without `if #available` ceremony. Dynamic Island additionally requires an iPhone 14 Pro or newer.
- SDK 55 removes `newArchEnabled: false` as a togglable option; the New Architecture is mandatory. App Group entitlements and shared-state setup for the multi-surface work in later phases assume the new arch.
- Xcode 26 ships Swift 6.2. App targets default to Approachable Concurrency; SPM packages (including the local Live Activity module) keep strict concurrency opt-in.
