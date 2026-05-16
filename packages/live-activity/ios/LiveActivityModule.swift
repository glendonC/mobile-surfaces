import ActivityKit
import ExpoModulesCore
import Foundation

// Expo Module surface for ActivityKit. Companion types live alongside in:
//   - LiveActivityError.swift            error enum bridged to JS
//   - ObserverRegistry.swift             actor-isolated Task-handle registry
//   - LiveActivityCodableBridge.swift    JSON-dict <-> Codable round-trip
// Each is independent of ExpoModulesCore so the Swift Package at
// packages/live-activity/ios/Tests can exercise them directly.

public class LiveActivityModule: Module {
  // The registry is created lazily in `definition()` once we have the iOS
  // 16.2+ guarantee; outside the guard we hold an opaque `Any?` so the type
  // doesn't leak iOS 16.2 availability into the module's stored properties.
  private var _registry: Any?

  @available(iOS 16.2, *)
  private var registry: ObserverRegistry {
    if let existing = _registry as? ObserverRegistry { return existing }
    let fresh = ObserverRegistry()
    _registry = fresh
    return fresh
  }

  deinit {
    // Fire-and-forget: snapshot the registry (no `self` capture) and let a
    // detached Task drain its cancellations. Safe in Swift 5.9 and 6.
    if #available(iOS 16.2, *) {
      if let registry = _registry as? ObserverRegistry {
        Task.detached { await registry.clearAll() }
      }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Events("onPushToken", "onActivityStateChange", "onPushToStartToken")

    AsyncFunction("areActivitiesEnabled") { () -> Bool in
      if #available(iOS 16.1, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("start") {
      (surfaceId: String, modeLabel: String, state: [String: Any], channelId: String?, options: [String: Any]?) -> [String: Any] in
      guard #available(iOS 16.2, *) else {
        throw LiveActivityError.unsupportedOS
      }

      let attrs = MobileSurfacesActivityAttributes(surfaceId: surfaceId, modeLabel: modeLabel)
      let parsed: MobileSurfacesActivityAttributes.ContentState =
        try LiveActivityCodableBridge.decode(state)
      let content = Self.activityContent(state: parsed, options: options)

      // Channel push (iOS 18+) is opt-in: only when the JS caller passes a
      // non-nil channelId AND we're on iOS 18. If they ask for it on an older
      // OS we surface a typed error so the adapter can show a clear message
      // instead of silently downgrading to token push.
      let activity: Activity<MobileSurfacesActivityAttributes>
      let isChannelMode: Bool
      if let channelId = channelId {
        if #available(iOS 18, *) {
          activity = try Activity.request(
            attributes: attrs,
            content: content,
            pushType: .channel(channelId)
          )
          isChannelMode = true
        } else {
          throw LiveActivityError.unsupportedFeature
        }
      } else {
        activity = try Activity.request(
          attributes: attrs,
          content: content,
          pushType: .token
        )
        isChannelMode = false
      }

      self.observe(activity: activity, isChannelMode: isChannelMode)

      var result: [String: Any] = [
        "id": activity.id,
        "state": try LiveActivityCodableBridge.encode(parsed)
      ]
      if let channelId = channelId {
        result["channelId"] = channelId
      }
      return result
    }

    AsyncFunction("update") { (activityId: String, state: [String: Any], options: [String: Any]?) -> Void in
      guard #available(iOS 16.2, *) else {
        throw LiveActivityError.unsupportedOS
      }
      guard let activity = Activity<MobileSurfacesActivityAttributes>.activities
        .first(where: { $0.id == activityId }) else {
        throw LiveActivityError.notFound
      }
      let parsed: MobileSurfacesActivityAttributes.ContentState =
        try LiveActivityCodableBridge.decode(state)
      await activity.update(Self.activityContent(state: parsed, options: options))
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
      return try Activity<MobileSurfacesActivityAttributes>.activities.map { activity in
        var entry: [String: Any] = [
          "id": activity.id,
          "surfaceId": activity.attributes.surfaceId,
          "modeLabel": activity.attributes.modeLabel,
          "state": try LiveActivityCodableBridge.encode(activity.content.state),
          "pushToken": NSNull()
        ]
        if let token = activity.pushToken {
          entry["pushToken"] = Self.hexString(token)
        }
        return entry
      }
    }

    // Returns the most-recent push-to-start token observed via the
    // OnStartObserving drain. Apple does not expose a synchronous query, so
    // we read from the actor-backed cache that the drain populates. A JS
    // caller racing the first emission gets `nil`; a caller that arrives
    // after at least one emission gets the token, instead of mistakenly
    // concluding "Apple hasn't delivered one".
    AsyncFunction("getPushToStartToken") { () -> String? in
      guard #available(iOS 17.2, *) else { return nil }
      return await self.registry.pushToStartToken()
    }

    OnStartObserving {
      if #available(iOS 16.2, *) {
        for activity in Activity<MobileSurfacesActivityAttributes>.activities {
          // Existing activities on cold start are always token-mode; channel
          // activities re-attach via the channel id passed back from JS.
          self.observe(activity: activity, isChannelMode: false)
        }
      }
      // Push-to-start is iOS 17.2+. Drain the class-level AsyncSequence and
      // emit `onPushToStartToken` for each token Apple hands us, AND cache
      // the latest token on the registry so synchronous queries via
      // `getPushToStartToken()` resolve to the real value.
      //
      // FB21158660: After a forced app termination the system-side stream can
      // go silent (no further token rotations are delivered) until the next
      // device boot or a privileged reset. This is an Apple-side bug with no
      // client-side workaround — we simply re-attach when the bridge restarts
      // and rely on the next system-issued rotation.
      if #available(iOS 17.2, *) {
        let registry = self.registry
        let task = Task { [weak self] in
          for await tokenData in Activity<MobileSurfacesActivityAttributes>.pushToStartTokenUpdates {
            if Task.isCancelled { return }
            guard let self = self else { return }
            let hex = Self.hexString(tokenData)
            // MS020: treat the latest emission as authoritative. Cache first
            // so a JS caller racing the event still sees the new value
            // synchronously via getPushToStartToken().
            await registry.setPushToStartToken(hex)
            self.sendEvent("onPushToStartToken", ["token": hex])
          }
        }
        Task { await registry.replacePushToStart(task) }
      }
    }

    // Symmetric counterpart to OnStartObserving. When the JS bridge detaches
    // every listener (component unmount with no other subscribers) Expo
    // invokes this; without it, the drain Tasks keep iterating against the
    // AsyncSequences forever and re-attach stacks new ones on next mount.
    //
    // Contract with OnStartObserving (MS020 / MS016): `clearAll()` cancels
    // every per-activity drain in flight, which on its own would drop future
    // token rotations on existing activities across a bridge teardown. The
    // recovery path lives in OnStartObserving above: it iterates
    // `Activity<MobileSurfacesActivityAttributes>.activities` and calls
    // `observe(activity:isChannelMode:)` for each one, re-attaching fresh
    // drains. If you change OnStartObserving's startup loop (for example,
    // gating it behind a flag or moving it out of the cold-start path), update
    // this site too — otherwise per-activity push-token rotation goes silent
    // after the first bridge teardown and the failure is invisible until a
    // backend `pushTokenUpdates` stream stops emitting.
    OnStopObserving {
      if #available(iOS 16.2, *) {
        let registry = self.registry
        Task { await registry.clearAll() }
      }
    }
  }

  // MARK: - Observers

  /// Attach `pushTokenUpdates` and `activityStateUpdates` drains to `activity`.
  ///
  /// Re-entry safe: if `OnStartObserving` fires again for an activity we are
  /// already watching (e.g. JS bridge reconnect), the prior Tasks are cancelled
  /// before new ones are stored. Each Task self-cancels on `Task.isCancelled`
  /// every iteration and on a `nil` weak-self check.
  ///
  /// `isChannelMode` controls whether the per-activity `pushTokenUpdates`
  /// drain is attached. Channel-mode activities (iOS 18 `.channel(channelId)`)
  /// never receive per-activity tokens from Apple — the AsyncSequence simply
  /// never emits — so attaching a drain stacks an idle Task per channel
  /// activity. Skip it entirely.
  @available(iOS 16.2, *)
  private func observe(activity: Activity<MobileSurfacesActivityAttributes>, isChannelMode: Bool) {
    let registry = self.registry
    let activityId = activity.id

    var tasks: [Task<Void, Never>] = []

    if !isChannelMode {
      let tokenTask = Task { [weak self] in
        for await tokenData in activity.pushTokenUpdates {
          if Task.isCancelled { return }
          guard let self = self else { return }
          self.sendEvent("onPushToken", [
            "activityId": activity.id,
            "token": Self.hexString(tokenData)
          ])
        }
      }
      tasks.append(tokenTask)
    }

    let stateTask = Task { [weak self] in
      for await update in activity.activityStateUpdates {
        if Task.isCancelled { return }
        guard let self = self else { return }
        let label: String = {
          switch update {
          case .active: return "active"
          case .ended: return "ended"
          case .dismissed: return "dismissed"
          case .stale: return "stale"
          case .pending: return "pending"
          // Future-Apple-added cases surface as "unknown" rather than
          // collapsing into "active". The JS layer treats unknown as a
          // non-terminal observed state — neither dropping the activity from
          // its tracking list nor pretending the activity is still healthy.
          @unknown default: return "unknown"
          }
        }()
        self.sendEvent("onActivityStateChange", [
          "activityId": activity.id,
          "state": label
        ])
        // Terminal states: drain the registry slot so we don't leak Task
        // handles after ActivityKit closes the AsyncSequence on its end.
        if update == .ended || update == .dismissed {
          await registry.clear(id: activityId)
          return
        }
      }
    }
    tasks.append(stateTask)

    // Hand the new handles to the registry; this also cancels any prior
    // observers for the same activity ID (re-entry from OnStartObserving etc.).
    Task { await registry.replace(id: activityId, tasks: tasks) }
  }

  private static func hexString(_ data: Data) -> String {
    return data.map { String(format: "%02x", $0) }.joined()
  }

  /// Build an `ActivityContent` from an optional JS-supplied options bag.
  /// Threads `staleDate` (unix seconds → `Date`) and `relevanceScore`
  /// through Apple's wrapper so the bridge no longer hard-codes
  /// `staleDate: nil`. JS callers omit fields by passing `nil` /
  /// undefined; the wrapper accepts `nil` for both. Used by both
  /// `start()` and `update()` so the two paths cannot drift.
  @available(iOS 16.2, *)
  private static func activityContent(
    state: MobileSurfacesActivityAttributes.ContentState,
    options: [String: Any]?
  ) -> ActivityContent<MobileSurfacesActivityAttributes.ContentState> {
    let staleDate: Date? = {
      guard let raw = options?["staleDateSeconds"] else { return nil }
      // JS numbers arrive as Double through the ExpoModulesCore bridge.
      // Accept Int and NSNumber too in case a caller pre-coerced.
      let seconds: Double?
      if let d = raw as? Double { seconds = d }
      else if let i = raw as? Int { seconds = Double(i) }
      else if let n = raw as? NSNumber { seconds = n.doubleValue }
      else { seconds = nil }
      guard let seconds, seconds > 0 else { return nil }
      return Date(timeIntervalSince1970: seconds)
    }()
    let relevanceScore: Double? = {
      guard let raw = options?["relevanceScore"] else { return nil }
      if let d = raw as? Double { return d }
      if let i = raw as? Int { return Double(i) }
      if let n = raw as? NSNumber { return n.doubleValue }
      return nil
    }()
    if let relevanceScore {
      return ActivityContent(
        state: state,
        staleDate: staleDate,
        relevanceScore: relevanceScore
      )
    }
    return ActivityContent(state: state, staleDate: staleDate)
  }
}
