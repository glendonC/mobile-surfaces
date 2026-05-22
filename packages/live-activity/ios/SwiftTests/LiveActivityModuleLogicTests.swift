import XCTest
@testable import LiveActivityTestable

// Decision logic extracted from LiveActivityModule.swift. The module itself
// stays ActivityKit-coupled and is exercised by the host-app compile in
// ios-build.yml; the branches its Activity.request / update / end calls
// depend on live in LiveActivityModuleLogic and are pinned here.

final class LiveActivityModuleLogicTests: XCTestCase {

    // MARK: - Push-type decision

    func testNilChannelIdSelectsTokenPush() {
        XCTAssertEqual(
            LiveActivityModuleLogic.pushTypeDecision(channelId: nil, isIOS18OrLater: true),
            .token
        )
        XCTAssertEqual(
            LiveActivityModuleLogic.pushTypeDecision(channelId: nil, isIOS18OrLater: false),
            .token
        )
    }

    func testChannelIdOnIOS18SelectsChannelPush() {
        XCTAssertEqual(
            LiveActivityModuleLogic.pushTypeDecision(channelId: "chan-1", isIOS18OrLater: true),
            .channel("chan-1")
        )
    }

    func testChannelIdBelowIOS18IsUnsupportedFeature() {
        // The trap the adapter surfaces: a channel push requested on iOS 17.x
        // must be a typed failure, not a silent downgrade to token push.
        XCTAssertEqual(
            LiveActivityModuleLogic.pushTypeDecision(channelId: "chan-1", isIOS18OrLater: false),
            .unsupportedFeature
        )
    }

    func testEmptyChannelIdStillCountsAsAChannelRequest() {
        // An empty string is non-nil: the caller asked for channel mode. The
        // decision does not validate the id's contents — that is the channel
        // package's job (MS031) — it only routes on presence.
        XCTAssertEqual(
            LiveActivityModuleLogic.pushTypeDecision(channelId: "", isIOS18OrLater: true),
            .channel("")
        )
    }

    // MARK: - Dismissal policy

    func testDismissalPolicyImmediateOnlyForLiteralImmediate() {
        XCTAssertTrue(LiveActivityModuleLogic.dismissalPolicyIsImmediate("immediate"))
        XCTAssertFalse(LiveActivityModuleLogic.dismissalPolicyIsImmediate("default"))
        // Any unrecognised value falls back to the default policy rather
        // than throwing — end() must not fail on an unknown policy string.
        XCTAssertFalse(LiveActivityModuleLogic.dismissalPolicyIsImmediate(""))
        XCTAssertFalse(LiveActivityModuleLogic.dismissalPolicyIsImmediate("Immediate"))
        XCTAssertFalse(LiveActivityModuleLogic.dismissalPolicyIsImmediate("after"))
    }

    // MARK: - Number coercion

    func testCoerceNumberAcceptsDoubleIntAndNSNumber() {
        XCTAssertEqual(LiveActivityModuleLogic.coerceNumber(1.5), 1.5)
        XCTAssertEqual(LiveActivityModuleLogic.coerceNumber(3), 3.0)
        XCTAssertEqual(LiveActivityModuleLogic.coerceNumber(NSNumber(value: 7)), 7.0)
    }

    func testCoerceNumberRejectsNonNumericAndMissing() {
        XCTAssertNil(LiveActivityModuleLogic.coerceNumber(nil))
        XCTAssertNil(LiveActivityModuleLogic.coerceNumber("12"))
        XCTAssertNil(LiveActivityModuleLogic.coerceNumber(NSNull()))
        XCTAssertNil(LiveActivityModuleLogic.coerceNumber(["a"]))
    }

    // MARK: - staleDateSeconds

    func testStaleDateSecondsReadsAPositiveValue() {
        let options: [String: Any] = ["staleDateSeconds": 1_700_000_000]
        XCTAssertEqual(
            LiveActivityModuleLogic.staleDateSeconds(fromOptions: options),
            1_700_000_000
        )
    }

    func testStaleDateSecondsIsNilWhenAbsentOrNilOptions() {
        XCTAssertNil(LiveActivityModuleLogic.staleDateSeconds(fromOptions: nil))
        XCTAssertNil(LiveActivityModuleLogic.staleDateSeconds(fromOptions: [:]))
        XCTAssertNil(LiveActivityModuleLogic.staleDateSeconds(fromOptions: ["other": 1]))
    }

    func testStaleDateSecondsRejectsZeroAndNegative() {
        // The positivity gate: a 0 / negative staleDate would mark the
        // activity immediately stale. Both must be dropped to nil so the
        // module passes `staleDate: nil` instead.
        XCTAssertNil(LiveActivityModuleLogic.staleDateSeconds(fromOptions: ["staleDateSeconds": 0]))
        XCTAssertNil(
            LiveActivityModuleLogic.staleDateSeconds(fromOptions: ["staleDateSeconds": -10])
        )
    }

    func testStaleDateSecondsAcceptsDoubleAndNSNumber() {
        XCTAssertEqual(
            LiveActivityModuleLogic.staleDateSeconds(fromOptions: ["staleDateSeconds": 12.0]),
            12.0
        )
        XCTAssertEqual(
            LiveActivityModuleLogic.staleDateSeconds(
                fromOptions: ["staleDateSeconds": NSNumber(value: 99)]
            ),
            99.0
        )
    }

    // MARK: - relevanceScore

    func testRelevanceScoreReadsValueWithNoPositivityGate() {
        // Unlike staleDateSeconds, a 0 relevanceScore is meaningful and must
        // survive — only a missing / non-numeric value yields nil.
        XCTAssertEqual(
            LiveActivityModuleLogic.relevanceScore(fromOptions: ["relevanceScore": 0]),
            0.0
        )
        XCTAssertEqual(
            LiveActivityModuleLogic.relevanceScore(fromOptions: ["relevanceScore": -5]),
            -5.0
        )
        XCTAssertEqual(
            LiveActivityModuleLogic.relevanceScore(fromOptions: ["relevanceScore": 0.75]),
            0.75
        )
    }

    func testRelevanceScoreIsNilWhenAbsentOrNonNumeric() {
        XCTAssertNil(LiveActivityModuleLogic.relevanceScore(fromOptions: nil))
        XCTAssertNil(LiveActivityModuleLogic.relevanceScore(fromOptions: [:]))
        XCTAssertNil(LiveActivityModuleLogic.relevanceScore(fromOptions: ["relevanceScore": "hi"]))
    }

    // MARK: - Activity-state mapping

    func testActivityStateLabelMapsEveryKnownCase() {
        XCTAssertEqual(LiveActivityModuleLogic.activityStateLabel(forCaseName: "active"), "active")
        XCTAssertEqual(LiveActivityModuleLogic.activityStateLabel(forCaseName: "ended"), "ended")
        XCTAssertEqual(
            LiveActivityModuleLogic.activityStateLabel(forCaseName: "dismissed"),
            "dismissed"
        )
        XCTAssertEqual(LiveActivityModuleLogic.activityStateLabel(forCaseName: "stale"), "stale")
        XCTAssertEqual(LiveActivityModuleLogic.activityStateLabel(forCaseName: "pending"), "pending")
    }

    func testActivityStateLabelIsNilForUnrecognisedCase() {
        // The module's `@unknown default` routes any future Apple-added case
        // here; a nil result tells it to fall back to the "unknown" label.
        XCTAssertNil(LiveActivityModuleLogic.activityStateLabel(forCaseName: "frozen"))
        XCTAssertNil(LiveActivityModuleLogic.activityStateLabel(forCaseName: ""))
    }

    func testUnknownActivityStateLabelIsUnknown() {
        // A future Apple case must surface as "unknown", never collapse into
        // "active" — the JS layer treats "unknown" as non-terminal-observed.
        XCTAssertEqual(LiveActivityModuleLogic.unknownActivityStateLabel, "unknown")
    }

    func testIsTerminalActivityStateOnlyForEndedAndDismissed() {
        XCTAssertTrue(LiveActivityModuleLogic.isTerminalActivityState("ended"))
        XCTAssertTrue(LiveActivityModuleLogic.isTerminalActivityState("dismissed"))
        XCTAssertFalse(LiveActivityModuleLogic.isTerminalActivityState("active"))
        XCTAssertFalse(LiveActivityModuleLogic.isTerminalActivityState("stale"))
        XCTAssertFalse(LiveActivityModuleLogic.isTerminalActivityState("pending"))
        XCTAssertFalse(LiveActivityModuleLogic.isTerminalActivityState("unknown"))
    }

    // MARK: - Token formatting

    func testHexStringEncodesBytesLowercaseZeroPadded() {
        XCTAssertEqual(
            LiveActivityModuleLogic.hexString(Data([0x00, 0x0f, 0xab, 0xff])),
            "000fabff"
        )
    }

    func testHexStringOfEmptyDataIsEmptyString() {
        XCTAssertEqual(LiveActivityModuleLogic.hexString(Data()), "")
    }

    func testHexStringRoundTripsA32ByteTokenLength() {
        // APNs device tokens are 32 bytes; the hex form the JS layer ships
        // must be exactly 64 lowercase characters.
        let token = Data((0..<32).map { UInt8($0) })
        let hex = LiveActivityModuleLogic.hexString(token)
        XCTAssertEqual(hex.count, 64)
        XCTAssertEqual(hex, hex.lowercased())
    }
}
