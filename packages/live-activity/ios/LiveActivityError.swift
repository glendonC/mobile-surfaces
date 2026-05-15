import Foundation

// The Swift error type the LiveActivity module throws across the JS bridge.
// Extracted from LiveActivityModule.swift so the codable bridge and the
// observer registry can be linted, unit-tested, and depended on without
// pulling in ExpoModulesCore.
//
// ExpoModulesCore promise-bridges Swift throws into JS rejections. Returning
// a stable string code on the JS side requires both `CustomStringConvertible`
// (Expo reads `String(describing:)` for the rejection message) and
// `LocalizedError.errorDescription` (Expo also inspects this on some paths).
// Mirror the two so both call paths produce the same JS-visible string.
//
// The JS side matches on the leading `ACTIVITY_*` code; do not rename
// existing cases or shorten their codes without a coordinated SDK bump.
enum LiveActivityError: Error, CustomStringConvertible, LocalizedError {
  case unsupportedOS
  case notFound
  // Carries the underlying decode reason so the JS layer can include the
  // failing field in its error path instead of an opaque "ACTIVITY_DECODE_FAILED".
  case decodingFailed(reason: String)
  case encodingFailed(reason: String)
  // Raised when a caller asks for a feature that exists in the module's
  // contract but is unavailable on the current OS (e.g. iOS 18 channel push
  // requested while running on iOS 17.x). Distinct from `unsupportedOS` so
  // the JS layer can distinguish "the whole module is dark" from "this one
  // knob needs a newer OS".
  case unsupportedFeature

  var description: String {
    switch self {
    case .unsupportedOS: return "ACTIVITY_UNSUPPORTED_OS"
    case .notFound: return "ACTIVITY_NOT_FOUND"
    case .decodingFailed(let reason): return "ACTIVITY_DECODE_FAILED: \(reason)"
    case .encodingFailed(let reason): return "ACTIVITY_ENCODE_FAILED: \(reason)"
    case .unsupportedFeature: return "ACTIVITY_UNSUPPORTED_FEATURE"
    }
  }

  var errorDescription: String? { description }
}
