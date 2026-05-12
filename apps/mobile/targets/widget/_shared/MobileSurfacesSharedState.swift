import Foundation
import WidgetKit

enum MobileSurfacesSharedState {
  static let appGroup = "group.com.example.mobilesurfaces"
  static let widgetCurrentSurfaceIdKey = "surface.widget.currentSurfaceId"
  static let controlCurrentSurfaceIdKey = "surface.control.currentSurfaceId"
  static let lockAccessoryCurrentSurfaceIdKey = "surface.lockAccessory.currentSurfaceId"
  static let standbyCurrentSurfaceIdKey = "surface.standby.currentSurfaceId"
  static let homeWidgetKind = "MobileSurfacesHomeWidget"
  static let controlWidgetKind = "MobileSurfacesControlWidget"
  static let lockAccessoryWidgetKind = "MobileSurfacesLockAccessoryWidget"
  static let standbyWidgetKind = "MobileSurfacesStandbyWidget"

  static var defaults: UserDefaults? {
    UserDefaults(suiteName: appGroup)
  }

  static func snapshotKey(surfaceId: String) -> String {
    "surface.snapshot.\(surfaceId)"
  }

  static func widgetSnapshot() -> MobileSurfacesWidgetSnapshot? {
    guard
      let surfaceId = defaults?.string(forKey: widgetCurrentSurfaceIdKey),
      let raw = defaults?.string(forKey: snapshotKey(surfaceId: surfaceId)),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }
    return try? JSONDecoder().decode(MobileSurfacesWidgetSnapshot.self, from: data)
  }

  static func controlSnapshot() -> MobileSurfacesControlSnapshot? {
    guard
      let surfaceId = defaults?.string(forKey: controlCurrentSurfaceIdKey),
      let raw = defaults?.string(forKey: snapshotKey(surfaceId: surfaceId)),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }
    return try? JSONDecoder().decode(MobileSurfacesControlSnapshot.self, from: data)
  }

  static func lockAccessorySnapshot() -> MobileSurfacesLockAccessorySnapshot? {
    guard
      let surfaceId = defaults?.string(forKey: lockAccessoryCurrentSurfaceIdKey),
      let raw = defaults?.string(forKey: snapshotKey(surfaceId: surfaceId)),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }
    return try? JSONDecoder().decode(MobileSurfacesLockAccessorySnapshot.self, from: data)
  }

  static func standbySnapshot() -> MobileSurfacesStandbySnapshot? {
    guard
      let surfaceId = defaults?.string(forKey: standbyCurrentSurfaceIdKey),
      let raw = defaults?.string(forKey: snapshotKey(surfaceId: surfaceId)),
      let data = raw.data(using: .utf8)
    else {
      return nil
    }
    return try? JSONDecoder().decode(MobileSurfacesStandbySnapshot.self, from: data)
  }

  static func writeControlValue(_ value: Bool) {
    guard
      let defaults,
      let surfaceId = defaults.string(forKey: controlCurrentSurfaceIdKey),
      let raw = defaults.string(forKey: snapshotKey(surfaceId: surfaceId)),
      let data = raw.data(using: .utf8),
      var snapshot = try? JSONDecoder().decode(MobileSurfacesControlSnapshot.self, from: data)
    else {
      return
    }

    snapshot.value = value
    if let next = try? JSONEncoder().encode(snapshot),
       let nextRaw = String(data: next, encoding: .utf8) {
      defaults.set(nextRaw, forKey: snapshotKey(surfaceId: surfaceId))
    }
  }
}

struct MobileSurfacesWidgetSnapshot: Codable, Hashable {
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
  var kind: String
  var snapshotId: String
  var surfaceId: String
  var state: String
  var family: String
  var headline: String
  var shortText: String
  var gaugeValue: Double
  var deepLink: String
}

struct MobileSurfacesStandbySnapshot: Codable, Hashable {
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
