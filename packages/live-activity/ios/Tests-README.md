# LiveActivity Swift unit tests

Standalone Swift Package that exercises the platform-agnostic Swift
surfaces extracted from `LiveActivityModule.swift` in v5:

- `LiveActivityError` — the typed error enum bridged to JS
- `ObserverRegistry` — the actor that owns Task handles for the
  ActivityKit AsyncSequence drains
- `LiveActivityCodableBridge` — the JSON-dict <-> Codable round-trip

None of these files `import ActivityKit` or `ExpoModulesCore`, so `swift
test` runs natively on macOS without spinning up an iOS simulator. The
ActivityKit-coupled code (`LiveActivityModule.swift`,
`MobileSurfacesActivityAttributes.swift`) stays exercised by the
host-app compile in `.github/workflows/ios-build.yml`.

## Run locally

```
swift test --package-path packages/live-activity/ios
```

Requires Swift 5.9+ (Xcode 26 ships 6.0; SPM treats 5.9 as the floor
declared in `Package.swift`).

## Run in CI

The `swift-tests` job in `.github/workflows/ios-build.yml` runs this on
`macos-26` after the iOS build job succeeds.
