import Foundation
import OSLog
import WidgetKit

/// Schema version this widget binary was compiled against. Host snapshots
/// emitting a different schemaVersion render a placeholder instead of decoding,
/// preventing silent rendering of incompatible shapes (MS041). Bumped in
/// lockstep with the Zod `schemaVersion` literal on the projection-output
/// schemas in `packages/surface-contracts/src/schema.ts`.
public let EXPECTED_SCHEMA_VERSION = "5"

/// Result of a two-stage snapshot read. The reader decodes
/// `{ "schemaVersion": String }` first and compares against
/// `EXPECTED_SCHEMA_VERSION` before attempting the full struct decode. A
/// mismatch is loud rather than silent: the widget switches on `.versionMismatch`
/// and renders `MobileSurfacesVersionMismatchView` so the user sees "Update
/// <surface>" instead of half-rendered or placeholder data.
public enum SnapshotReadResult<T: Decodable> {
  case empty
  case versionMismatch(found: String, expected: String)
  case decodeError(Error)
  case ok(T)
}

private struct SchemaVersionProbe: Decodable {
  let schemaVersion: String
}

enum MobileSurfacesSharedState {
  static let appGroup = MobileSurfacesAppGroup.identifier
  static let widgetCurrentSurfaceIdKey = "surface.widget.currentSurfaceId"
  static let controlCurrentSurfaceIdKey = "surface.control.currentSurfaceId"
  static let lockAccessoryCurrentSurfaceIdKey = "surface.lockAccessory.currentSurfaceId"
  static let standbyCurrentSurfaceIdKey = "surface.standby.currentSurfaceId"
  static let homeWidgetKind = "MobileSurfacesHomeWidget"
  static let controlWidgetKind = "MobileSurfacesControlWidget"
  static let lockAccessoryWidgetKind = "MobileSurfacesLockAccessoryWidget"
  static let standbyWidgetKind = "MobileSurfacesStandbyWidget"

  // Staleness thresholds (seconds). Defaults of 24h match the brief.
  // External-snapshot widgets pin `policy: .never`; without a hint the view
  // would render the last-written snapshot forever after a host crash. These
  // thresholds drive a subtle (dimmed / leading-dot) signal in the view layer.
  static let homeStaleAfter: TimeInterval = 24 * 60 * 60
  static let lockAccessoryStaleAfter: TimeInterval = 24 * 60 * 60
  static let standbyStaleAfter: TimeInterval = 24 * 60 * 60

  // Cache the suite handle once per process. UserDefaults caches internally by
  // suiteName, but binding the handle to a `static let` also makes the failure
  // mode reproducible: if the App Group entitlement is missing or misconfigured
  // (MS013/MS025), every read sees the same nil rather than a flaky-looking
  // transient. The one-shot logger below fires the first time any caller
  // observes the nil so the misconfiguration surfaces in Console.app without
  // requiring a JS round-trip.
  static let defaults: UserDefaults? = {
    let suite = UserDefaults(suiteName: appGroup)
    if suite == nil {
      _ = appGroupMissingLogOnce
    }
    return suite
  }()

  // Lazy global: the closure runs at most once on first access, regardless of
  // which call site triggers it. Stored as `Void` since we only care about the
  // side effect.
  private static let appGroupMissingLogOnce: Void = {
    let message = "[MobileSurfaces] App Group container not available (suite: \(appGroup)). App Group entitlement missing or misconfigured — see MS013/MS025."
    if #available(iOS 14.0, *) {
      Logger(subsystem: "com.mobilesurfaces.widget", category: "appGroup").error("\(message, privacy: .public)")
    } else {
      print(message)
    }
  }()

  static func snapshotKey(surfaceId: String) -> String {
    "surface.snapshot.\(surfaceId)"
  }

  // Sibling key the host writes alongside the snapshot JSON. Unix seconds as
  // a TimeInterval (Double). Separate from `updatedAt` inside the snapshot
  // payload so MS036 parity stays intact: this is a transport-layer
  // breadcrumb, not part of the projection-output contract.
  static func writtenAtKey(surfaceId: String) -> String {
    "surface.snapshot.\(surfaceId).writtenAt"
  }

  // Decode-error breadcrumb. The host's diagnostics (`checkSetup.ts`, owned by
  // the CLI agent) reads this to surface "widget extension last failed to
  // decode at <iso>" instead of "placeholder is rendering for no reason".
  static func decodeErrorKey(surfaceId: String) -> String {
    "surface.snapshot.\(surfaceId).decodeError"
  }

  static func widgetSnapshot() -> MobileSurfacesWidgetSnapshot? {
    decodeSnapshot(currentSurfaceIdKey: widgetCurrentSurfaceIdKey)
  }

  static func controlSnapshot() -> MobileSurfacesControlSnapshot? {
    decodeSnapshot(currentSurfaceIdKey: controlCurrentSurfaceIdKey)
  }

  static func lockAccessorySnapshot() -> MobileSurfacesLockAccessorySnapshot? {
    decodeSnapshot(currentSurfaceIdKey: lockAccessoryCurrentSurfaceIdKey)
  }

  static func standbySnapshot() -> MobileSurfacesStandbySnapshot? {
    decodeSnapshot(currentSurfaceIdKey: standbyCurrentSurfaceIdKey)
  }

  /// Version-aware snapshot read. Decodes `{ schemaVersion }` first and
  /// compares against `EXPECTED_SCHEMA_VERSION` before decoding the full
  /// struct. Callers switch on the result to render a version-mismatch
  /// placeholder rather than falling back to a generic placeholder that
  /// hides the cause (MS041).
  static func readSnapshot<T: Decodable>(
    currentSurfaceIdKey: String,
    type: T.Type = T.self
  ) -> SnapshotReadResult<T> {
    guard
      let defaults,
      let surfaceId = defaults.string(forKey: currentSurfaceIdKey),
      let raw = defaults.string(forKey: snapshotKey(surfaceId: surfaceId)),
      let data = raw.data(using: .utf8)
    else {
      return .empty
    }
    let probe: SchemaVersionProbe
    do {
      probe = try JSONDecoder().decode(SchemaVersionProbe.self, from: data)
    } catch {
      recordDecodeError(surfaceId: surfaceId, error: error)
      return .decodeError(error)
    }
    if probe.schemaVersion != EXPECTED_SCHEMA_VERSION {
      return .versionMismatch(
        found: probe.schemaVersion,
        expected: EXPECTED_SCHEMA_VERSION
      )
    }
    do {
      let decoded = try JSONDecoder().decode(T.self, from: data)
      defaults.removeObject(forKey: decodeErrorKey(surfaceId: surfaceId))
      return .ok(decoded)
    } catch {
      recordDecodeError(surfaceId: surfaceId, error: error)
      return .decodeError(error)
    }
  }

  // Read the writtenAt breadcrumb for whatever surfaceId is currently bound
  // to `currentSurfaceIdKey`. Returns nil when the breadcrumb is absent (older
  // host build, fresh install) so the view layer can treat "no breadcrumb" as
  // "trust the snapshot" rather than flagging stale.
  static func snapshotWrittenAt(currentSurfaceIdKey: String) -> Date? {
    guard
      let defaults,
      let surfaceId = defaults.string(forKey: currentSurfaceIdKey)
    else {
      return nil
    }
    let value = defaults.double(forKey: writtenAtKey(surfaceId: surfaceId))
    // `.double(forKey:)` returns 0 for missing keys; treat 0 / negative as
    // absent rather than 1970-01-01.
    guard value > 0 else { return nil }
    return Date(timeIntervalSince1970: value)
  }

  // Returns true when the breadcrumb is older than `threshold` seconds.
  // Missing breadcrumb -> false (no claim either way; the view shouldn't dim
  // for older host builds that don't write the breadcrumb).
  static func isSnapshotStale(writtenAt: Date?, threshold: TimeInterval) -> Bool {
    guard let writtenAt else { return false }
    return Date().timeIntervalSince(writtenAt) > threshold
  }

  static func writeControlValue(_ value: Bool) {
    // Route the read through decodeSnapshot so a schema-drift failure here
    // surfaces the same breadcrumb the regular reader uses (an old TestFlight
    // binary toggling a control widget against a new host's snapshot has a
    // recoverable failure path; silent swallow used to hide it).
    guard
      let defaults,
      let surfaceId = defaults.string(forKey: controlCurrentSurfaceIdKey),
      var snapshot: MobileSurfacesControlSnapshot = decodeSnapshot(currentSurfaceIdKey: controlCurrentSurfaceIdKey)
    else {
      return
    }
    snapshot.value = value
    let key = snapshotKey(surfaceId: surfaceId)
    do {
      let data = try JSONEncoder().encode(snapshot)
      guard let raw = String(data: data, encoding: .utf8) else {
        // Encoder produced non-UTF8 bytes, which Codable's JSONEncoder
        // cannot in practice. Record a breadcrumb so the diagnostics
        // surface anything that ever does land here, then bail.
        recordEncodeError(
          surfaceId: surfaceId,
          message: "JSONEncoder output is not valid UTF-8",
        )
        return
      }
      defaults.set(raw, forKey: key)
    } catch {
      recordEncodeError(surfaceId: surfaceId, error: error)
    }
  }

  // Encode-side counterpart to recordDecodeError. Reuses the same breadcrumb
  // key the reader checks, with a distinct `type` so host diagnostics can
  // distinguish a stale read from a failed write.
  private static func recordEncodeError(surfaceId: String, error: Error? = nil, message: String? = nil) {
    guard let defaults else { return }
    let payload: [String: Any] = [
      "at": iso8601Formatter.string(from: Date()),
      "error": message
        ?? (error as? LocalizedError)?.errorDescription
        ?? error.map { String(describing: $0) }
        ?? "unknown encode failure",
      "type": "encode:" + (error.map { String(describing: Swift.type(of: $0)) } ?? "message"),
    ]
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let raw = String(data: data, encoding: .utf8) {
      defaults.set(raw, forKey: decodeErrorKey(surfaceId: surfaceId))
    }
    #if DEBUG
    print("[MobileSurfaces] encode failed for \(snapshotKey(surfaceId: surfaceId)): \(message ?? error.map(String.init(describing:)) ?? "unknown")")
    #endif
  }

  // MARK: - Decode helper
  //
  // Centralised so all four surface readers share one error-handling path. A
  // JSONDecoder throw used to be swallowed by `try?`, which made schema drift
  // (old TestFlight binary, new host pushing v4) indistinguishable from "no
  // snapshot written yet". Now decode failures:
  //   1. write a breadcrumb to the App Group (`surface.snapshot.<id>.decodeError`)
  //      so host diagnostics can surface them, and
  //   2. in DEBUG builds, print to the extension console.
  // The caller still receives `nil` so the widget falls back to its placeholder
  // instead of crashing the extension.
  private static func decodeSnapshot<T: Decodable>(
    currentSurfaceIdKey: String,
    type: T.Type = T.self
  ) -> T? {
    guard
      let defaults,
      let surfaceId = defaults.string(forKey: currentSurfaceIdKey),
      let raw = defaults.string(forKey: snapshotKey(surfaceId: surfaceId)),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }
    do {
      let decoded = try JSONDecoder().decode(T.self, from: data)
      // Clear any prior breadcrumb on success so diagnostics don't flag a
      // recovered surface as still-broken.
      defaults.removeObject(forKey: decodeErrorKey(surfaceId: surfaceId))
      return decoded
    } catch {
      recordDecodeError(surfaceId: surfaceId, error: error)
      return nil
    }
  }

  private static func recordDecodeError(surfaceId: String, error: Error) {
    guard let defaults else { return }
    let payload: [String: Any] = [
      "at": iso8601Formatter.string(from: Date()),
      "error": (error as? LocalizedError)?.errorDescription ?? String(describing: error),
      "type": String(describing: Swift.type(of: error))
    ]
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let raw = String(data: data, encoding: .utf8) {
      defaults.set(raw, forKey: decodeErrorKey(surfaceId: surfaceId))
    }
    #if DEBUG
    print("[MobileSurfaces] decode failed for \(snapshotKey(surfaceId: surfaceId)): \(error)")
    #endif
  }

  private static let iso8601Formatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
}

struct MobileSurfacesWidgetSnapshot: Codable, Hashable {
  var schemaVersion: String
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var state: String
  var family: String?
  var reloadPolicy: String?
  var headline: String
  var subhead: String
  var progress: Double
  var deepLink: String
}

struct MobileSurfacesControlSnapshot: Codable, Hashable {
  var schemaVersion: String
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var controlKind: String
  var value: Bool?
  var intent: String?
  var label: String
  var deepLink: String
}

struct MobileSurfacesLockAccessorySnapshot: Codable, Hashable {
  var schemaVersion: String
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var state: String
  var family: String
  var headline: String
  var shortText: String?
  var gaugeValue: Double?
  var deepLink: String
}

struct MobileSurfacesStandbySnapshot: Codable, Hashable {
  var schemaVersion: String
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var state: String
  var presentation: String
  var tint: String?
  var headline: String
  var subhead: String
  var progress: Double
  var deepLink: String
}
