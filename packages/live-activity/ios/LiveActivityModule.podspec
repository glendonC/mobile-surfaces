require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiveActivityModule'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = { 'Glendon Chin' => 'glendonchin@gmail.com' }
  s.homepage       = 'https://github.com/glendonC/mobile-surfaces'
  s.platforms      = { :ios => '17.2' }
  # Swift 5 language mode for now; upgrade to 6.0 in Phase 5 once the
  # `observe(activity:)` Task observers are restructured (current shape can't
  # satisfy strict-concurrency `sending` checks while the parent BaseModule
  # has a non-MainActor `required init(appContext:)`). Pods don't auto-adopt
  # Swift 6 strict mode in Xcode 26, so 5.9 stays compatible with the rest of
  # the toolchain row.
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/glendonC/mobile-surfaces.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"

  # SwiftTests/ holds XCTest cases that `@testable import LiveActivityTestable`,
  # the SwiftPM-only library product defined in Package.swift at the package
  # root. Neither symbol exists in the CocoaPods consumer (host app + widget
  # extension compile) — that path links against ExpoModulesCore, not the
  # SwiftPM module. Without these exclusions the `**/*.swift` glob would
  # vacuum them into the LiveActivityModule pod target, where the
  # `@testable import LiveActivityTestable` and `import PackageDescription`
  # statements both fail to resolve. The standalone Swift Package
  # (swift-tests CI job) still sees these files via its own target globbing.
  s.exclude_files = ["SwiftTests/**/*", "Package.swift"]
end
