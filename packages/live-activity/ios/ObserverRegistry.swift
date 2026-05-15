// Foundation is sufficient: the actor itself stores Task handles and a
// String token cache. The reference to `Activity<...>.pushTokenUpdates`
// lives in the consuming module (LiveActivityModule.swift); this file is
// deliberately ActivityKit-free so the Swift Package at Tests/ can run
// `swift test` on macOS without an iOS simulator.
import Foundation

// Owns the `Task` handles spawned to drain `pushTokenUpdates` /
// `activityStateUpdates` AsyncSequences. Without explicit handles those Tasks
// are unbounded — `[weak self]` lets the module deallocate, but the Task
// itself keeps the AsyncSequence iterator alive and continues spinning.
// Storing handles here lets us:
//   1. Cancel prior observers when `OnStartObserving` re-fires for an
//      activity we are already watching (JS bridge reconnect, hot reload).
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
//
// Extracted from LiveActivityModule.swift in v5 so the registry can be
// unit-tested in a Swift Package that does not depend on ExpoModulesCore.
@available(iOS 16.2, macOS 13, *)
actor ObserverRegistry {
  private var handles: [String: [Task<Void, Never>]] = [:]
  // The push-to-start token stream is a class-level AsyncSequence on
  // `Activity<MobileSurfacesActivityAttributes>` (iOS 17.2+), not per-
  // activity, so a single handle is sufficient. Stored here so re-entry of
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

  // Test-only: observe internal counts. Marked internal (default) so the
  // Swift Package test target can exercise concurrency invariants without
  // sprouting per-test hooks elsewhere. Not used in production.
  func handleCount() -> Int { handles.values.reduce(0) { $0 + $1.count } }
  func activityIds() -> Set<String> { Set(handles.keys) }
  func hasPushToStartHandle() -> Bool { pushToStartHandle != nil }
}
