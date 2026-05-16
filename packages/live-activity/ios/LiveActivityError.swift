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
// MSTrapBound (v7+): cases that map to a catalog trap append a
// `[trap=MSXXX url=...]` suffix to `description`. The JS-side
// `LiveActivityNativeError` parses that suffix off the rejection message
// and stamps `trapId` / `docsUrl` on its instance. Cases that intentionally
// have no binding (encodingFailed, notFound — SDK self-correctness rather
// than silent-failure traps) emit a bare description.
//
// The JS side matches on the leading `ACTIVITY_*` code; do not rename
// existing cases or shorten their codes without a coordinated SDK bump.
enum LiveActivityError: Error, CustomStringConvertible, LocalizedError, MSTrapBound {
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

  private var baseDescription: String {
    switch self {
    case .unsupportedOS: return "ACTIVITY_UNSUPPORTED_OS"
    case .notFound: return "ACTIVITY_NOT_FOUND"
    case .decodingFailed(let reason): return "ACTIVITY_DECODE_FAILED: \(reason)"
    case .encodingFailed(let reason): return "ACTIVITY_ENCODE_FAILED: \(reason)"
    case .unsupportedFeature: return "ACTIVITY_UNSUPPORTED_FEATURE"
    }
  }

  // Catalog binding per case. `decodingFailed` surfaces MS003 (ContentState
  // wire-shape mismatch). `unsupportedOS` / `unsupportedFeature` both
  // surface MS012 (deployment target / iOS-version gating). `encodingFailed`
  // and `notFound` are SDK self-correctness paths with no silent-failure
  // trap, so they intentionally return nil.
  var trapId: String? {
    switch self {
    case .decodingFailed: return "MS003"
    case .unsupportedOS, .unsupportedFeature: return "MS012"
    case .encodingFailed, .notFound: return nil
    }
  }

  var docsUrl: String? {
    guard let id = trapId else { return nil }
    return MSTraps.find(id)?.docsUrl
  }

  var description: String {
    let base = baseDescription
    if let id = trapId, let url = docsUrl {
      return "\(base) [trap=\(id) url=\(url)]"
    }
    if let id = trapId {
      return "\(base) [trap=\(id)]"
    }
    return base
  }

  var errorDescription: String? { description }
}
