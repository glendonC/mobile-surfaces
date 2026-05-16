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
