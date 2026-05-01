// MUST stay byte-identical across the Expo module and widget target:
//   packages/live-activity/ios/MobileSurfacesActivityAttributes.swift
//   apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift
//
// ActivityKit binds the type used in `Activity<T>.request` (main app) to the
// type used in `ActivityConfiguration(for: T.self)` (widget extension) by
// matching ContentState/Attributes shape. The two definitions live in
// different Swift modules at compile time but must serialize identically.

import ActivityKit

struct MobileSurfacesActivityAttributes: ActivityAttributes, Sendable {
  public struct ContentState: Codable, Hashable, Sendable {
    var headline: String
    var subhead: String
    var progress: Double
    var stage: Stage
  }

  enum Stage: String, Codable, Hashable, Sendable {
    case prompted
    case inProgress
    case completing
  }

  var surfaceId: String
  var modeLabel: String
}
