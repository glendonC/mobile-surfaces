import ActivityKit
import ExpoModulesCore
import Foundation

// Expo Module surface for ActivityKit. Companion types live alongside in:
//   - LiveActivityError.swift            error enum bridged to JS
//   - ObserverRegistry.swift             actor-isolated Task-handle registry
//   - LiveActivityCodableBridge.swift    JSON-dict <-> Codable round-trip
//   - LiveActivityModuleLogic.swift      push-type / options / state decisions
// Each is independent of ExpoModulesCore so the Swift Package at
// packages/live-activity/ios/SwiftTests can exercise them directly. This
// file keeps only the ActivityKit calls that cannot run off-device
// (Activity.request / update / end and the AsyncSequence drains); the
// branches they depend on are decided in LiveActivityModuleLogic.

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

      // Channel push (iOS 18+) is opt-in. The token-vs-channel decision —
      // and the typed failure when a channel is requested on an older OS —
      // lives in LiveActivityModuleLogic.pushTypeDecision so it is unit
      // tested off-device; this site only performs the ActivityKit call the
      // decision selects.
      let isIOS18: Bool = { if #available(iOS 18, *) { return true }; return false }()
      let activity: Activity<MobileSurfacesActivityAttributes>
      let isChannelMode: Bool
      switch LiveActivityModuleLogic.pushTypeDecision(
        channelId: channelId,
        isIOS18OrLater: isIOS18
      ) {
      case .channel(let channelId):
        guard #available(iOS 18, *) else {
          // Unreachable: pushTypeDecision only returns .channel when
          // isIOS18OrLater is true. The guard satisfies the compiler's
          // availability check for the .channel(_) pushType below.
          throw LiveActivityError.unsupportedFeature
        }
        activity = try Activity.request(
          attributes: attrs,
          content: content,
          pushType: .channel(channelId)
        )
        isChannelMode = true
      case .token:
        activity = try Activity.request(
          attributes: attrs,
          content: content,
          pushType: .token
        )
        isChannelMode = false
      case .unsupportedFeature:
        throw LiveActivityError.unsupportedFeature
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
      let policy: ActivityUIDismissalPolicy =
        LiveActivityModuleLogic.dismissalPolicyIsImmediate(dismissalPolicy)
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
        // Spawn-and-register atomically (C8). The build closure runs inside
        // the actor's isolation, so by the time this Task's await resolves
        // the drain handle is in the registry; a clearObservers queued by a
        // concurrent OnStopObserving cannot land in a gap where the drain
        // exists but is untracked.
        Task {
          await registry.beginPushToStartObservation { [weak self] in
            Task<Void, Never> { [weak self] in
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
          }
        }

        // Drain the class-level `activityUpdates` AsyncSequence so push-to-
        // start deliveries that create a new Activity *after* the cold-start
        // enumeration above has finished are still observed live. Without
        // this drain, a token-mode delivery between the bridge attaching and
        // the next reattach is invisible — the per-instance pushTokenUpdates
        // / activityStateUpdates drains only attach via the `observe(...)`
        // helper, and the cold-start loop is the only place that calls it
        // for activities the bridge did not originate.
        //
        // Yielded activities are always token-mode (channel activities are
        // initiated by the bridge's own `start()` path, which calls
        // `observe(...)` directly). The per-id beginObservation inside
        // `observe(...)` is re-entry safe, so a duplicate yield against the
        // cold-start enumeration cancels the prior drains and reinstalls
        // them — no double-attach.
        Task {
          await registry.beginActivityUpdatesObservation { [weak self] in
            Task<Void, Never> { [weak self] in
              for await activity in Activity<MobileSurfacesActivityAttributes>.activityUpdates {
                if Task.isCancelled { return }
                guard let self = self else { return }
                self.observe(activity: activity, isChannelMode: false)
              }
            }
          }
        }
      }
    }

    // Symmetric counterpart to OnStartObserving. When the JS bridge detaches
    // every listener (component unmount with no other subscribers) Expo
    // invokes this; without it, the drain Tasks keep iterating against the
    // AsyncSequences forever and re-attach stacks new ones on next mount.
    //
    // Contract with OnStartObserving (MS020 / MS016): `clearObservers()`
    // cancels every per-activity drain installed via `beginObservation`, the
    // push-to-start drain installed via `beginPushToStartObservation`, and
    // the activity-updates drain installed via `beginActivityUpdatesObservation`.
    // Both registration methods install handles inside actor isolation, so a
    // clearObservers queued here always sees the handles a concurrent
    // OnStartObserving's `Task` set, regardless of which queued first on
    // the actor; the only race window is the actor's own arrival order,
    // which Swift serializes in submission order in practice. The recovery
    // path lives in OnStartObserving above: it iterates
    // `Activity<MobileSurfacesActivityAttributes>.activities` and calls
    // `observe(activity:isChannelMode:)` for each one, re-attaching fresh
    // drains. If you change OnStartObserving's startup loop (for example,
    // gating it behind a flag or moving it out of the cold-start path), update
    // this site too — otherwise per-activity push-token rotation goes silent
    // after the first bridge teardown and the failure is invisible until a
    // backend `pushTokenUpdates` stream stops emitting.
    //
    // This uses `clearObservers()`, not `clearAll()`: a listener detach must
    // not discard the cached push-to-start token. `clearAll()` (which also
    // drops the token) runs only from `deinit`, when the registry is gone.
    OnStopObserving {
      if #available(iOS 16.2, *) {
        let registry = self.registry
        Task { await registry.clearObservers() }
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

    // Spawn-and-register atomically (C8). Earlier code created the drain
    // Tasks first and queued a separate `Task { await registry.replace(...) }`
    // to install them; in the gap between spawn and install, a concurrent
    // OnStopObserving could clear an empty registry and the drains would
    // leak until the next replace. beginObservation runs the build closure
    // inside actor isolation, so the handles exist in the registry before
    // this call returns.
    Task {
      await registry.beginObservation(id: activityId) { [weak self] in
        var tasks: [Task<Void, Never>] = []

        if !isChannelMode {
          let tokenTask = Task<Void, Never> { [weak self] in
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

        let stateTask = Task<Void, Never> { [weak self] in
          for await update in activity.activityStateUpdates {
            if Task.isCancelled { return }
            guard let self = self else { return }
            // The known-case label strings live in LiveActivityModuleLogic so a
            // unit test pins them. `@unknown default` must stay here — it only
            // compiles against the real ActivityKit enum — and routes to
            // `unknownActivityStateLabel` so future Apple-added cases surface as
            // "unknown" rather than collapsing into "active". The JS layer
            // treats "unknown" as a non-terminal observed state.
            let caseName: String? = {
              switch update {
              case .active: return "active"
              case .ended: return "ended"
              case .dismissed: return "dismissed"
              case .stale: return "stale"
              case .pending: return "pending"
              @unknown default: return nil
              }
            }()
            let label: String = caseName
              .flatMap { LiveActivityModuleLogic.activityStateLabel(forCaseName: $0) }
              ?? LiveActivityModuleLogic.unknownActivityStateLabel
            self.sendEvent("onActivityStateChange", [
              "activityId": activity.id,
              "state": label
            ])
            // Terminal states: drain the registry slot so we don't leak Task
            // handles after ActivityKit closes the AsyncSequence on its end.
            if LiveActivityModuleLogic.isTerminalActivityState(label) {
              await registry.clear(id: activityId)
              return
            }
          }
        }
        tasks.append(stateTask)

        return tasks
      }
    }
  }

  private static func hexString(_ data: Data) -> String {
    return LiveActivityModuleLogic.hexString(data)
  }

  /// Build an `ActivityContent` from an optional JS-supplied options bag.
  /// Threads `staleDate` (unix seconds → `Date`) and `relevanceScore`
  /// through Apple's wrapper so the bridge no longer hard-codes
  /// `staleDate: nil`. JS callers omit fields by passing `nil` /
  /// undefined; the wrapper accepts `nil` for both. Used by both
  /// `start()` and `update()` so the two paths cannot drift.
  ///
  /// The options-bag parsing (number coercion, the positivity gate on
  /// `staleDateSeconds`) lives in LiveActivityModuleLogic so it is unit
  /// tested off-device; this method only constructs the ActivityKit
  /// `ActivityContent` wrapper from the parsed values.
  @available(iOS 16.2, *)
  private static func activityContent(
    state: MobileSurfacesActivityAttributes.ContentState,
    options: [String: Any]?
  ) -> ActivityContent<MobileSurfacesActivityAttributes.ContentState> {
    let staleDate: Date? = LiveActivityModuleLogic
      .staleDateSeconds(fromOptions: options)
      .map { Date(timeIntervalSince1970: $0) }
    let relevanceScore: Double? =
      LiveActivityModuleLogic.relevanceScore(fromOptions: options)
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
