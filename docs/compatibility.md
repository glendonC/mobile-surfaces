# Compatibility

Mobile Surfaces pins to a single tested toolchain row. Treat any cell change as an upgrade ritual: bump deliberately, run `pnpm surface:check && pnpm typecheck && pnpm dev:doctor && pnpm mobile:prebuild:ios` on a fresh clone, and update this row in the same PR.

| Expo SDK | React Native | iOS minimum | Xcode | `@bacons/apple-targets` |
| --- | --- | --- | --- | --- |
| 54 | 0.81.5 | 16.2 | 16.x (26.x reported as compatible by `pnpm dev:doctor`) | 4.0.6 |

Notes:

- `expo-build-properties` follows Expo SDK majors and is pinned to the SDK 54 line.
- `@bacons/apple-targets` is pinned to an exact patch because the author publishes from `main` without release tags; floating ranges have shipped breaking changes.
- iOS 16.2 is the minimum because Live Activity APIs (`Activity<Attributes>.request`, Dynamic Island) require it. Dynamic Island additionally requires an iPhone 14 Pro or newer.
