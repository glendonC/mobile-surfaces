import ActivityKit
import ExpoModulesCore
import Foundation

enum LiveActivityError: Error, CustomStringConvertible, LocalizedError {
  case unsupportedOS
  case notFound
  // Now carries the underlying decode reason so the JS layer can include the
  // failing field in its error path instead of "ACTIVITY_DECODE_FAILED" with
  // no detail. Used to be a flat enum case; widened so it can ride along.
  case decodingFailed(reason: String)
  case encodingFailed(reason: String)
  // Raised when a caller asks for a feature that exists in the module's
  // contract but is unavailable on the current OS (e.g. iOS 18 channel push
  // requested while running on iOS 17.x). Distinct from `unsupportedOS` so the
  // JS layer can distinguish "the whole module is dark" from "this one knob
  // needs a newer OS".
  case unsupportedFeature

  // ExpoModulesCore promise-bridges Swift throws into JS rejections. Returning
  // a stable string code on the JS side requires a CustomStringConvertible
  // description; Expo uses `String(describing:)` for the rejection message.
  // Keep the codes identical to the legacy enum-raw-value set so JS callers
  // matching on `error.code` don't break.
  var description: String {
    switch self {
    case .unsupportedOS: return "ACTIVITY_UNSUPPORTED_OS"
    case .notFound: return "ACTIVITY_NOT_FOUND"
    case .decodingFailed(let reason): return "ACTIVITY_DECODE_FAILED: \(reason)"
    case .encodingFailed(let reason): return "ACTIVITY_ENCODE_FAILED: \(reason)"
    case .unsupportedFeature: return "ACTIVITY_UNSUPPORTED_FEATURE"
    }
  }

  // LocalizedError conformance: ExpoModulesCore inspects this when wrapping
  // a Swift throw into a JS Error.message. Mirrors description so both paths
  // produce the same JS-visible string.
  var errorDescription: String? { description }
}

// MARK: - Observer task registry
//
// Owns the `Task` handles spawned to drain `pushTokenUpdates` /
// `activityStateUpdates` AsyncSequences. Without explicit handles those Tasks
// are unbounded — `[weak self]` lets the module deallocate, but the Task itself
// keeps the AsyncSequence iterator alive and continues spinning. Storing
// handles here lets us:
//   1. Cancel prior observers when `OnStartObserving` re-fires for an activity
//      we are already watching (JS bridge reconnect, hot reload, etc.).
//   2. Cancel observers on terminal activity states (.ended / .dismissed).
//   3. Cancel everything on `OnStopObserving` (JS bridge detached all
//      listeners) and on module teardown (`deinit`).
//
// The registry also caches the latest push-to-start token Apple has emitted.
// `getPushToStartToken()` reads this so a JS caller polling for the value
// after the event stream has already delivered it doesn't get a misleading
// `nil`. Token rotations (MS020 says treat-latest-as-authoritative) overwrite
// the cache; clearing happens on bridge teardown only.
//
// An `actor` is the right tool here: serial isolation without manual locking,
// fully available on Swift 5.9, and forward-compatible with Swift 6 strict
// concurrency.
@available(iOS 16.2, *)
private actor ObserverRegistry {
  private var handles: [String: [Task<Void, Never>]] = [:]
  // The push-to-start token stream is a class-level AsyncSequence on
  // `Activity<MobileSurfacesActivityAttributes>` (iOS 17.2+), not per-activity,
  // so a single handle is sufficient. Stored here so re-entry of
  // `OnStartObserving` cancels the prior task instead of stacking observers.
  private var pushToStartHandle: Task<Void, Never>?

  // Latest push-to-start token Apple delivered through the AsyncSequence.
  // `nil` until the first emission; rotated on every subsequent emission.
  private var latestPushToStartToken: String?

  /// Cancel any existing handles for `id` and replace them with `tasks`.
  func replace(id: String, tasks: [Task<Void, Never>]) {
    if let existing = handles[id] {
      for task in existing { task.cancel() }
    }
    handles[id] = tasks
  }

  /// Cancel and remove handles for a single activity (e.g. terminal state).
  func clear(id: String) {
    if let existing = handles.removeValue(forKey: id) {
      for task in existing { task.cancel() }
    }
  }

  /// Cancel + replace the single push-to-start observer task. Invoked from
  /// `OnStartObserving` (iOS 17.2+ only); re-entry cancels the prior drain.
  func replacePushToStart(_ task: Task<Void, Never>) {
    pushToStartHandle?.cancel()
    pushToStartHandle = task
  }

  /// Store the latest token observed on the push-to-start AsyncSequence.
  func setPushToStartToken(_ token: String) {
    latestPushToStartToken = token
  }

  func pushToStartToken() -> String? {
    latestPushToStartToken
  }

  /// Cancel and remove every stored handle. Called from `OnStopObserving`
  /// (JS bridge detached all listeners) and from `deinit`.
  func clearAll() {
    for (_, tasks) in handles {
      for task in tasks { task.cancel() }
    }
    handles.removeAll()
    pushToStartHandle?.cancel()
    pushToStartHandle = nil
    // Drop the cached token on teardown. A fresh OnStartObserving re-attaches
    // the drain and will repopulate from the next OS emission.
    latestPushToStartToken = nil
  }
}

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
      (surfaceId: String, modeLabel: String, state: [String: Any], channelId: String?) -> [String: Any] in
      guard #available(iOS 16.2, *) else {
        throw LiveActivityError.unsupportedOS
      }

      let attrs = MobileSurfacesActivityAttributes(surfaceId: surfaceId, modeLabel: modeLabel)
      let parsed = try Self.decodeState(state)
      let content = ActivityContent(state: parsed, staleDate: nil)

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
        "state": try Self.encodeState(parsed)
      ]
      if let channelId = channelId {
        result["channelId"] = channelId
      }
      return result
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
      return try Activity<MobileSurfacesActivityAttributes>.activities.map { activity in
        var entry: [String: Any] = [
          "id": activity.id,
          "surfaceId": activity.attributes.surfaceId,
          "modeLabel": activity.attributes.modeLabel,
          "state": try Self.encodeState(activity.content.state),
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
  /// never receive per-activity tokens from Apple - the AsyncSequence simply
  /// never emits - so attaching a drain stacks an idle Task per channel
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

  // MARK: - Codable bridge

  private static func decodeState(_ dict: [String: Any]) throws
    -> MobileSurfacesActivityAttributes.ContentState
  {
    do {
      let data = try JSONSerialization.data(withJSONObject: dict)
      return try JSONDecoder().decode(
        MobileSurfacesActivityAttributes.ContentState.self, from: data)
    } catch {
      // Surface the decoder's reason rather than collapsing every failure
      // mode (missing field, type mismatch, JSON malformed) into a single
      // opaque code. JS callers can match on the prefix and log the reason.
      throw LiveActivityError.decodingFailed(reason: String(describing: error))
    }
  }

  // Throws instead of silently returning `[:]`. ExpoModulesCore promise-bridges
  // Swift throws into JS rejections, so a callsite inside an AsyncFunction
  // bubbles correctly. An empty dictionary was the original silent-failure
  // mode the trap catalog calls out across the codebase - a successful
  // start/listActive that hands back nothing recognisable downstream.
  private static func encodeState(
    _ state: MobileSurfacesActivityAttributes.ContentState
  ) throws -> [String: Any] {
    let data: Data
    do {
      data = try JSONEncoder().encode(state)
    } catch {
      throw LiveActivityError.encodingFailed(reason: String(describing: error))
    }
    let obj: Any
    do {
      obj = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw LiveActivityError.encodingFailed(reason: "JSONSerialization failed: \(error)")
    }
    guard let dict = obj as? [String: Any] else {
      throw LiveActivityError.encodingFailed(
        reason: "encoded ContentState is not a JSON object"
      )
    }
    return dict
  }

  private static func hexString(_ data: Data) -> String {
    return data.map { String(format: "%02x", $0) }.joined()
  }
}
