// swift-tools-version:5.9
//
// Standalone Swift Package that exercises the platform-agnostic Swift
// surfaces extracted from LiveActivityModule.swift. None of these files
// import ActivityKit or ExpoModulesCore, so `swift test` runs natively on
// macOS without an iOS simulator. The actual ActivityKit-coupled code
// (LiveActivityModule.swift itself, MobileSurfacesActivityAttributes.swift)
// stays out of this package — it is exercised by the host-app compile in
// ios-build.yml.
//
// Package root is packages/live-activity/ios/ so SwiftPM can include the
// three platform-agnostic Swift files directly without `path: "../"`,
// which SwiftPM 5.10+ rejects with "target ... is outside the package
// root". CocoaPods reads LiveActivityModule.podspec at the same level
// (different tool, different metadata file); the two coexist cleanly.

import PackageDescription

let package = Package(
    name: "LiveActivity",
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
            // Sources live next to Package.swift. Exclude the ActivityKit-
            // coupled / build-system-metadata files so the package compiles
            // on plain macOS without ExpoModulesCore.
            path: ".",
            exclude: [
                "LiveActivityModule.swift",
                "LiveActivityModule.podspec",
                "MobileSurfacesActivityAttributes.swift",
                "SwiftTests",
                "Tests-README.md",
            ],
            sources: [
                "LiveActivityError.swift",
                "ObserverRegistry.swift",
                "LiveActivityCodableBridge.swift",
                // MS040 byte-identity replica. LiveActivityError conforms to
                // MSTrapBound and stamps trapId / docsUrl via MSTraps; the
                // protocol + lookup must be in the same SwiftPM target.
                "MobileSurfacesTraps.swift",
            ]
        ),
        .testTarget(
            name: "LiveActivityTests",
            dependencies: ["LiveActivityTestable"],
            path: "SwiftTests"
        ),
    ]
)
