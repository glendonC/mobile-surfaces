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
        XCTAssertEqual(await registry.handleCount(), 1)
        XCTAssertTrue(await registry.activityIds().contains("ACT-1"))

        await registry.clear(id: "ACT-1")
        XCTAssertEqual(await registry.handleCount(), 0)
        XCTAssertFalse(await registry.activityIds().contains("ACT-1"))
    }

    func testClearAllCancelsEveryHandleAndPushToStart() async {
        let registry = ObserverRegistry()
        let activityTask = Task<Void, Never> {}
        let pushToStartTask = Task<Void, Never> {}
        await registry.replace(id: "ACT-1", tasks: [activityTask])
        await registry.replacePushToStart(pushToStartTask)
        await registry.setPushToStartToken("hex-token")
        XCTAssertEqual(await registry.handleCount(), 1)
        XCTAssertTrue(await registry.hasPushToStartHandle())
        XCTAssertEqual(await registry.pushToStartToken(), "hex-token")

        await registry.clearAll()
        XCTAssertEqual(await registry.handleCount(), 0)
        XCTAssertFalse(await registry.hasPushToStartHandle())
        // Token cache cleared on teardown so a fresh bridge session does not
        // surface a stale value.
        XCTAssertNil(await registry.pushToStartToken())
    }

    func testPushToStartTokenLatestWinsMS020() async {
        // MS020: treat the latest emission as authoritative. The registry's
        // setPushToStartToken overwrites the cached value; subsequent reads
        // see the latest write.
        let registry = ObserverRegistry()
        await registry.setPushToStartToken("first")
        await registry.setPushToStartToken("second")
        XCTAssertEqual(await registry.pushToStartToken(), "second")
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
        XCTAssertEqual(await registry.activityIds().count, 50)
        XCTAssertEqual(await registry.handleCount(), 50)
    }
}
