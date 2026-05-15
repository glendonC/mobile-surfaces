// swift-tools-version:5.9
//
// Standalone Swift Package that exercises the platform-agnostic Swift
// surfaces extracted from LiveActivityModule.swift. None of these files
// import ActivityKit or ExpoModulesCore, so `swift test` runs natively on
// macOS without an iOS simulator. The actual ActivityKit-coupled code
// (LiveActivityModule.swift itself, MobileSurfacesActivityAttributes.swift)
// stays out of this package — it is exercised by the host-app compile in
// ios-build.yml.

import PackageDescription

let package = Package(
    name: "LiveActivityTests",
    platforms: [
        // macOS 13 is the floor for the actor / Task<Void, Never> /
        // structured-concurrency APIs the registry depends on. iOS is
        // declared so the same sources keep their @available semantics in
        // shape, but tests run on the macOS host.
        .macOS(.v13),
        .iOS(.v16),
    ],
    products: [
        .library(name: "LiveActivityTestable", targets: ["LiveActivityTestable"]),
    ],
    targets: [
        .target(
            name: "LiveActivityTestable",
            // path-reference the three Swift files in the parent ios/ dir.
            // Keeping the test target out of the same target as the rest of
            // the LiveActivityModule.podspec sources avoids the
            // ExpoModulesCore / ActivityKit dependency surface.
            path: "../",
            exclude: [
                "LiveActivityModule.swift",
                "LiveActivityModule.podspec",
                "MobileSurfacesActivityAttributes.swift",
                "Tests",
            ],
            sources: [
                "LiveActivityError.swift",
                "ObserverRegistry.swift",
                "LiveActivityCodableBridge.swift",
            ]
        ),
        .testTarget(
            name: "LiveActivityTests",
            dependencies: ["LiveActivityTestable"],
            path: "Tests"
        ),
    ]
)
