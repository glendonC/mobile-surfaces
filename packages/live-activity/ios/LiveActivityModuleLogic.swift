import Foundation

// Platform-agnostic decision logic extracted from LiveActivityModule.swift.
// None of this imports ActivityKit or ExpoModulesCore, so the Swift Package
// at packages/live-activity/ios can unit-test it on plain macOS. The module
// keeps only the ActivityKit calls that genuinely cannot run off-device
// (Activity.request / update / end and the AsyncSequence drains); every
// branch those calls depend on is decided here so the decision is testable
// in isolation and the two `start()` / `update()` paths cannot drift.
//
// Each helper mirrors the original inline behavior byte-for-byte; this file
// is a pure refactor for testability, not a behavior change.
enum LiveActivityModuleLogic {

  // MARK: - Push-type decision

  /// The push transport `start()` selects for a new activity.
  ///
  /// Channel push (iOS 18+) is opt-in: only when the JS caller passes a
  /// non-nil channelId AND the device is on iOS 18. Asking for a channel on
  /// an older OS is a typed failure (`unsupportedFeature`) so the adapter can
  /// show a clear message instead of silently downgrading to token push.
  enum PushTypeDecision: Equatable {
    case token
    case channel(String)
    /// Caller passed a channelId on an OS older than iOS 18.
    case unsupportedFeature
  }

  /// Decide the push transport for `start()`.
  ///
  /// - Parameters:
  ///   - channelId: the channel id from JS, or nil for token push.
  ///   - isIOS18OrLater: whether the runtime is iOS 18+.
  static func pushTypeDecision(
    channelId: String?,
    isIOS18OrLater: Bool
  ) -> PushTypeDecision {
    guard let channelId = channelId else {
      return .token
    }
    return isIOS18OrLater ? .channel(channelId) : .unsupportedFeature
  }

  // MARK: - Dismissal policy

  /// `end()` maps the JS dismissalPolicy string to the ActivityKit policy.
  /// Only the literal "immediate" selects the immediate policy; every other
  /// value (including "default" and any unrecognised string) falls back to
  /// the default policy. Returning the boolean keeps the ActivityKit enum
  /// out of this file; the module turns it into `ActivityUIDismissalPolicy`.
  static func dismissalPolicyIsImmediate(_ raw: String) -> Bool {
    return raw == "immediate"
  }

  // MARK: - Content-state options threading

  /// Coerce a JS-bridged numeric option to a `Double`.
  ///
  /// JS numbers arrive as `Double` through the ExpoModulesCore bridge, but a
  /// caller may have pre-coerced to `Int`, and `NSNumber` shows up on some
  /// paths. Anything else (string, null, missing) yields nil.
  static func coerceNumber(_ raw: Any?) -> Double? {
    guard let raw = raw else { return nil }
    if let d = raw as? Double { return d }
    if let i = raw as? Int { return Double(i) }
    if let n = raw as? NSNumber { return n.doubleValue }
    return nil
  }

  /// The `staleDate` seconds-since-epoch threaded from the options bag, or
  /// nil when absent / non-positive / non-numeric. The module turns a
  /// non-nil value into `Date(timeIntervalSince1970:)`. A non-positive value
  /// is rejected so a caller passing 0 / a negative number does not produce
  /// an immediately-stale activity.
  static func staleDateSeconds(fromOptions options: [String: Any]?) -> Double? {
    guard let seconds = coerceNumber(options?["staleDateSeconds"]) else { return nil }
    guard seconds > 0 else { return nil }
    return seconds
  }

  /// The `relevanceScore` threaded from the options bag, or nil when absent
  /// / non-numeric. Unlike `staleDateSeconds` there is no positivity gate:
  /// ActivityKit accepts any Double, and a 0 score is meaningful.
  static func relevanceScore(fromOptions options: [String: Any]?) -> Double? {
    return coerceNumber(options?["relevanceScore"])
  }

  // MARK: - Activity-state mapping

  /// JS-visible label for an ActivityKit `ActivityState` case name.
  ///
  /// The module's `activityStateUpdates` drain switches over the ActivityKit
  /// enum — that switch must stay in the module because `@unknown default`
  /// only compiles against the real enum. It routes each known case through
  /// this function by raw name so the label strings are pinned by a unit
  /// test and the `@unknown default` -> "unknown" contract is exercised
  /// here via `unknownActivityStateLabel`.
  ///
  /// Returns nil for an unrecognised raw name; callers fall back to
  /// `unknownActivityStateLabel`.
  static func activityStateLabel(forCaseName raw: String) -> String? {
    switch raw {
    case "active": return "active"
    case "ended": return "ended"
    case "dismissed": return "dismissed"
    case "stale": return "stale"
    case "pending": return "pending"
    default: return nil
    }
  }

  /// Label emitted for a future Apple-added `ActivityState` case the switch
  /// has not been taught yet. The JS layer treats "unknown" as a
  /// non-terminal observed state — neither dropping the activity nor
  /// pretending it is healthy.
  static let unknownActivityStateLabel = "unknown"

  /// Whether an activity-state label is terminal. On a terminal state the
  /// module drains the registry slot so it does not leak Task handles after
  /// ActivityKit closes the AsyncSequence. Only "ended" and "dismissed" are
  /// terminal; "stale" and "pending" are not.
  static func isTerminalActivityState(_ label: String) -> Bool {
    return label == "ended" || label == "dismissed"
  }

  // MARK: - Token formatting

  /// Lowercase hex encoding of a push-token `Data` blob, as handed to JS.
  static func hexString(_ data: Data) -> String {
    return data.map { String(format: "%02x", $0) }.joined()
  }
}
