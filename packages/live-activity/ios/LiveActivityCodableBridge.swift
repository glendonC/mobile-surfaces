import Foundation

// The JSON-dictionary <-> Codable bridge used by the LiveActivity module
// when it crosses the ExpoModulesCore boundary. Extracted from
// LiveActivityModule.swift so the round-trip is unit-testable in a Swift
// Package independent of ExpoModulesCore.
//
// Both ends throw `LiveActivityError.decodingFailed` / `.encodingFailed`
// with the underlying reason in the associated value, so the JS layer can
// match on the leading `ACTIVITY_DECODE_FAILED:` / `ACTIVITY_ENCODE_FAILED:`
// prefix and surface the field-level detail (vs the original opaque codes
// that left the failing field invisible).
//
// encode() throws instead of silently returning [:]. That empty-dictionary
// shape was the original silent-failure mode the trap catalog calls out
// across the codebase: a successful start() / listActive() that handed back
// nothing recognisable downstream.
enum LiveActivityCodableBridge {
  /// Decode a JS-emitted `[String: Any]` dictionary into a Codable type.
  static func decode<T: Decodable>(
    _ dict: [String: Any],
    as _: T.Type = T.self
  ) throws -> T {
    do {
      let data = try JSONSerialization.data(withJSONObject: dict)
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw LiveActivityError.decodingFailed(reason: String(describing: error))
    }
  }

  /// Encode a Codable value into a JS-shaped `[String: Any]` dictionary.
  /// Throws on any of: encoder failure, JSONSerialization failure, or a
  /// non-object root.
  static func encode<T: Encodable>(_ value: T) throws -> [String: Any] {
    let data: Data
    do {
      data = try JSONEncoder().encode(value)
    } catch {
      throw LiveActivityError.encodingFailed(reason: String(describing: error))
    }
    let obj: Any
    do {
      obj = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw LiveActivityError.encodingFailed(
        reason: "JSONSerialization failed: \(error)"
      )
    }
    guard let dict = obj as? [String: Any] else {
      throw LiveActivityError.encodingFailed(
        reason: "encoded value is not a JSON object"
      )
    }
    return dict
  }
}
