import XCTest
@testable import LiveActivityTestable

// Tests for the actor that owns Live Activity Task handles. The actor's
// serial isolation is the load-bearing concurrency guarantee — without it
// the AsyncSequence drains can stack across hot-reloads and bridge
// reconnects. These tests pin the contract the Phase 1 audit identified
// as the most ActivityKit-heavy logic with no automated coverage today.

@available(iOS 16.2, macOS 13, *)
final class ObserverRegistryTests: XCTestCase {

    func testReplaceCancelsPriorTasks() async {
        let registry = ObserverRegistry()
        let firstFinished = expectation(description: "first task observes cancellation")
        let firstTask = Task<Void, Never> {
            while !Task.isCancelled {
                await Task.yield()
            }
            firstFinished.fulfill()
        }
        await registry.replace(id: "ACT-1", tasks: [firstTask])

        // Issue the replacement; the registry must cancel the prior task.
        let secondTask = Task<Void, Never> {}
        await registry.replace(id: "ACT-1", tasks: [secondTask])

        await fulfillment(of: [firstFinished], timeout: 2.0)
        XCTAssertTrue(firstTask.isCancelled)
    }

    func testClearCancelsAndRemovesSingleId() async {
        let registry = ObserverRegistry()
        let task = Task<Void, Never> {}
        await registry.replace(id: "ACT-1", tasks: [task])
        // Swift 6 forbids `await` inside an XCTAssert autoclosure (the
        // autoclosure does not inherit the enclosing async context).
        // Bind each result to a local first.
        let firstCount = await registry.handleCount()
        XCTAssertEqual(firstCount, 1)
        let firstIds = await registry.activityIds()
        XCTAssertTrue(firstIds.contains("ACT-1"))

        await registry.clear(id: "ACT-1")
        let postClearCount = await registry.handleCount()
        XCTAssertEqual(postClearCount, 0)
        let postClearIds = await registry.activityIds()
        XCTAssertFalse(postClearIds.contains("ACT-1"))
    }

    func testClearAllCancelsEveryHandleAndPushToStart() async {
        let registry = ObserverRegistry()
        let activityTask = Task<Void, Never> {}
        let pushToStartTask = Task<Void, Never> {}
        await registry.replace(id: "ACT-1", tasks: [activityTask])
        await registry.replacePushToStart(pushToStartTask)
        await registry.setPushToStartToken("hex-token")
        let preCount = await registry.handleCount()
        XCTAssertEqual(preCount, 1)
        let preHasPushToStart = await registry.hasPushToStartHandle()
        XCTAssertTrue(preHasPushToStart)
        let preToken = await registry.pushToStartToken()
        XCTAssertEqual(preToken, "hex-token")

        await registry.clearAll()
        let postCount = await registry.handleCount()
        XCTAssertEqual(postCount, 0)
        let postHasPushToStart = await registry.hasPushToStartHandle()
        XCTAssertFalse(postHasPushToStart)
        // Token cache cleared on teardown so a fresh bridge session does not
        // surface a stale value.
        let postToken = await registry.pushToStartToken()
        XCTAssertNil(postToken)
    }

    func testClearObserversCancelsHandlesButKeepsPushToStartToken() async {
        // OnStopObserving (a listener detach, e.g. a component unmount) calls
        // clearObservers(), which cancels every drain Task but must preserve
        // the cached push-to-start token: a detach is not evidence the token
        // went stale, and a remount re-attaches the drain. Dropping the token
        // here would make a post-remount getPushToStartToken() poll return a
        // misleading nil. clearAll() (deinit only) is the path that drops it.
        let registry = ObserverRegistry()
        let activityTask = Task<Void, Never> {}
        let pushToStartTask = Task<Void, Never> {}
        await registry.replace(id: "ACT-1", tasks: [activityTask])
        await registry.replacePushToStart(pushToStartTask)
        await registry.setPushToStartToken("hex-token")

        await registry.clearObservers()
        let postCount = await registry.handleCount()
        XCTAssertEqual(postCount, 0)
        let postHasPushToStart = await registry.hasPushToStartHandle()
        XCTAssertFalse(postHasPushToStart)
        // The token survives the observer teardown.
        let postToken = await registry.pushToStartToken()
        XCTAssertEqual(postToken, "hex-token")
    }

    func testPushToStartTokenIsNilBeforeFirstEmission() async {
        // Cold-start contract for MS016: until the AsyncSequence drain emits
        // its first token, `pushToStartToken()` returns nil. A non-nil default
        // (e.g. "") would let the JS layer ship a malformed token to the
        // backend and mistake "Apple has not handed us one yet" for "we have
        // a valid token". Pairs with testClearAllCancelsEveryHandleAndPushToStart
        // which covers the reset-after-teardown case.
        let registry = ObserverRegistry()
        let token = await registry.pushToStartToken()
        XCTAssertNil(token)
    }

    func testPushToStartTokenLatestWinsMS020() async {
        // MS020: treat the latest emission as authoritative. The registry's
        // setPushToStartToken overwrites the cached value; subsequent reads
        // see the latest write.
        let registry = ObserverRegistry()
        await registry.setPushToStartToken("first")
        await registry.setPushToStartToken("second")
        let token = await registry.pushToStartToken()
        XCTAssertEqual(token, "second")
    }

    func testReplacePushToStartCancelsPriorTask() async {
        let registry = ObserverRegistry()
        let firstFinished = expectation(description: "prior push-to-start observes cancellation")
        let firstTask = Task<Void, Never> {
            while !Task.isCancelled {
                await Task.yield()
            }
            firstFinished.fulfill()
        }
        await registry.replacePushToStart(firstTask)

        let secondTask = Task<Void, Never> {}
        await registry.replacePushToStart(secondTask)

        await fulfillment(of: [firstFinished], timeout: 2.0)
        XCTAssertTrue(firstTask.isCancelled)
    }

    func testBeginPushToStartObservationSpawnsAndStoresAtomically() async {
        // C8: the spawn-then-register pattern in LiveActivityModule had two
        // separate Tasks (one for the drain, one for the registration). A
        // tight detach during attach could see the drain Task in flight with
        // no handle yet stored, leaving the OnStopObserving cancel a no-op.
        // beginPushToStartObservation closes that window: the build closure
        // runs inside actor isolation, so the spawned Task is stored before
        // the actor returns.
        let registry = ObserverRegistry()
        await registry.beginPushToStartObservation {
            Task<Void, Never> {
                while !Task.isCancelled { await Task.yield() }
            }
        }
        // By the time the actor call returns, the registry holds a handle.
        let hasHandle = await registry.hasPushToStartHandle()
        XCTAssertTrue(hasHandle)

        // A subsequent clearObservers cancels the stored task; the prior
        // window in which the task could exist unregistered is gone.
        await registry.clearObservers()
        let postClearHasHandle = await registry.hasPushToStartHandle()
        XCTAssertFalse(postClearHasHandle)
    }

    func testBeginPushToStartObservationCancelsPriorBeforeSpawn() async {
        // Re-entry of OnStartObserving (JS bridge reconnect, hot reload) must
        // cancel the prior drain before installing a new one. Two consecutive
        // beginPushToStartObservation calls leave exactly one live handle and
        // the prior task observes cancellation.
        let registry = ObserverRegistry()
        let firstFinished = expectation(description: "prior task observes cancellation")
        await registry.beginPushToStartObservation {
            Task<Void, Never> {
                while !Task.isCancelled { await Task.yield() }
                firstFinished.fulfill()
            }
        }
        await registry.beginPushToStartObservation {
            Task<Void, Never> {}
        }
        await fulfillment(of: [firstFinished], timeout: 2.0)
        let hasHandle = await registry.hasPushToStartHandle()
        XCTAssertTrue(hasHandle)
    }

    func testBeginObservationSpawnsAndStoresAtomicallyPerActivity() async {
        // Same atomicity as beginPushToStartObservation, for the per-activity
        // drain pair. The build closure produces an array of Task handles;
        // the registry installs them under the activity id.
        let registry = ObserverRegistry()
        await registry.beginObservation(id: "ACT-1") {
            let t1 = Task<Void, Never> {
                while !Task.isCancelled { await Task.yield() }
            }
            let t2 = Task<Void, Never> {
                while !Task.isCancelled { await Task.yield() }
            }
            return [t1, t2]
        }
        let count = await registry.handleCount()
        XCTAssertEqual(count, 2)
        let ids = await registry.activityIds()
        XCTAssertTrue(ids.contains("ACT-1"))

        // Re-entry: a second beginObservation under the same id cancels the
        // prior tasks and installs the new ones in a single isolated step.
        await registry.beginObservation(id: "ACT-1") {
            [Task<Void, Never> {}]
        }
        let postCount = await registry.handleCount()
        XCTAssertEqual(postCount, 1)
    }

    func testConcurrentReplacesDoNotInterleave() async {
        // Actor serialization invariant: 50 parallel `replace` calls under
        // distinct ids must leave exactly 50 entries — never fewer (would
        // mean a clobber) and never more (impossible by construction).
        let registry = ObserverRegistry()
        await withTaskGroup(of: Void.self) { group in
            for i in 0..<50 {
                group.addTask {
                    let task = Task<Void, Never> {}
                    await registry.replace(id: "ACT-\(i)", tasks: [task])
                }
            }
        }
        let finalIds = await registry.activityIds()
        XCTAssertEqual(finalIds.count, 50)
        let finalCount = await registry.handleCount()
        XCTAssertEqual(finalCount, 50)
    }
}
