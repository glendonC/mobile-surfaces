import ActivityKit
import ExpoModulesCore
import Foundation

enum LiveActivityError: String, Error {
  case unsupportedOS = "ACTIVITY_UNSUPPORTED_OS"
  case notFound = "ACTIVITY_NOT_FOUND"
  case decodingFailed = "ACTIVITY_DECODE_FAILED"
}

public class LiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Events("onPushToken", "onActivityStateChange")

    AsyncFunction("areActivitiesEnabled") { () -> Bool in
      if #available(iOS 16.1, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("start") {
      (surfaceId: String, modeLabel: String, state: [String: Any]) -> [String: Any] in
      guard #available(iOS 16.2, *) else {
        throw LiveActivityError.unsupportedOS
      }

      let attrs = MobileSurfacesActivityAttributes(surfaceId: surfaceId, modeLabel: modeLabel)
      let parsed = try Self.decodeState(state)
      let content = ActivityContent(state: parsed, staleDate: nil)

      let activity = try Activity.request(
        attributes: attrs,
        content: content,
        pushType: .token
      )

      self.observe(activity: activity)

      return [
        "id": activity.id,
        "state": Self.encodeState(parsed)
      ]
    }

    AsyncFunction("update") { (activityId: String, state: [String: Any]) -> Void in
      guard #available(iOS 16.2, *) else {
        throw LiveActivityError.unsupportedOS
      }
      guard let activity = Activity<MobileSurfacesActivityAttributes>.activities
        .first(where: { $0.id == activityId }) else {
        throw LiveActivityError.notFound
      }
      let parsed = try Self.decodeState(state)
      await activity.update(ActivityContent(state: parsed, staleDate: nil))
    }

    AsyncFunction("end") {
      (activityId: String, dismissalPolicy: String) -> Void in
      guard #available(iOS 16.2, *) else {
        throw LiveActivityError.unsupportedOS
      }
      guard let activity = Activity<MobileSurfacesActivityAttributes>.activities
        .first(where: { $0.id == activityId }) else {
        throw LiveActivityError.notFound
      }
      let policy: ActivityUIDismissalPolicy = (dismissalPolicy == "immediate")
        ? .immediate : .default
      await activity.end(nil, dismissalPolicy: policy)
    }

    AsyncFunction("listActive") { () -> [[String: Any]] in
      guard #available(iOS 16.2, *) else { return [] }
      return Activity<MobileSurfacesActivityAttributes>.activities.map { activity in
        var entry: [String: Any] = [
          "id": activity.id,
          "surfaceId": activity.attributes.surfaceId,
          "modeLabel": activity.attributes.modeLabel,
          "state": Self.encodeState(activity.content.state),
          "pushToken": NSNull()
        ]
        if let token = activity.pushToken {
          entry["pushToken"] = Self.hexString(token)
        }
        return entry
      }
    }

    OnStartObserving {
      if #available(iOS 16.2, *) {
        for activity in Activity<MobileSurfacesActivityAttributes>.activities {
          self.observe(activity: activity)
        }
      }
    }
  }

  // MARK: - Observers

  @available(iOS 16.2, *)
  private func observe(activity: Activity<MobileSurfacesActivityAttributes>) {
    Task { [weak self] in
      for await tokenData in activity.pushTokenUpdates {
        guard let self = self else { return }
        self.sendEvent("onPushToken", [
          "activityId": activity.id,
          "token": Self.hexString(tokenData)
        ])
      }
    }
    Task { [weak self] in
      for await update in activity.activityStateUpdates {
        guard let self = self else { return }
        let label: String = {
          switch update {
          case .active: return "active"
          case .ended: return "ended"
          case .dismissed: return "dismissed"
          case .stale: return "stale"
          case .pending: return "pending"
          @unknown default: return "active"
          }
        }()
        self.sendEvent("onActivityStateChange", [
          "activityId": activity.id,
          "state": label
        ])
      }
    }
  }

  // MARK: - Codable bridge

  private static func decodeState(_ dict: [String: Any]) throws
    -> MobileSurfacesActivityAttributes.ContentState
  {
    do {
      let data = try JSONSerialization.data(withJSONObject: dict)
      return try JSONDecoder().decode(
        MobileSurfacesActivityAttributes.ContentState.self, from: data)
    } catch {
      throw LiveActivityError.decodingFailed
    }
  }

  private static func encodeState(
    _ state: MobileSurfacesActivityAttributes.ContentState
  ) -> [String: Any] {
    guard let data = try? JSONEncoder().encode(state),
          let obj = try? JSONSerialization.jsonObject(with: data),
          let dict = obj as? [String: Any] else {
      return [:]
    }
    return dict
  }

  private static func hexString(_ data: Data) -> String {
    return data.map { String(format: "%02x", $0) }.joined()
  }
}
