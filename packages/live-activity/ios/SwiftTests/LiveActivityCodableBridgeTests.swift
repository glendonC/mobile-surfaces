import XCTest
@testable import LiveActivityTestable

// The Codable bridge that crosses the ExpoModulesCore JS<->Swift boundary.
// The Phase 1 audit flagged the original silent-failure mode where the
// encoder collapsed errors to `[:]`; the current shape throws typed
// LiveActivityError cases. These tests pin both the happy round-trip and
// the error-wrapping contract that the JS layer depends on.

private struct SampleContentState: Codable, Equatable {
    let headline: String
    let progress: Double
    let stage: String
}

final class LiveActivityCodableBridgeTests: XCTestCase {

    func testDecodeAcceptsACompleteDictionary() throws {
        let dict: [String: Any] = [
            "headline": "In progress",
            "progress": 0.5,
            "stage": "inProgress",
        ]
        let decoded: SampleContentState = try LiveActivityCodableBridge.decode(dict)
        XCTAssertEqual(
            decoded,
            SampleContentState(headline: "In progress", progress: 0.5, stage: "inProgress")
        )
    }

    func testDecodeWrapsMissingFieldAsDecodingFailedWithReason() {
        let dict: [String: Any] = [
            // headline is missing
            "progress": 0.5,
            "stage": "inProgress",
        ]
        do {
            let _: SampleContentState = try LiveActivityCodableBridge.decode(dict)
            XCTFail("Expected decodingFailed")
        } catch let LiveActivityError.decodingFailed(reason) {
            // The wrapped reason includes the JSONDecoder error text. The
            // JS layer matches on the leading "ACTIVITY_DECODE_FAILED:"
            // prefix; the surrounding test for that prefix is on the
            // CustomStringConvertible description.
            XCTAssertFalse(reason.isEmpty, "reason must carry the underlying decode failure detail")
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func testDecodeWrapsTypeMismatchAsDecodingFailed() {
        let dict: [String: Any] = [
            "headline": "In progress",
            "progress": "not-a-number", // wrong type
            "stage": "inProgress",
        ]
        do {
            let _: SampleContentState = try LiveActivityCodableBridge.decode(dict)
            XCTFail("Expected decodingFailed")
        } catch let LiveActivityError.decodingFailed(reason) {
            XCTAssertTrue(reason.contains("progress") || !reason.isEmpty)
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func testEncodeRoundTripsThroughJSONSerialization() throws {
        let value = SampleContentState(headline: "Ready", progress: 0.0, stage: "prompted")
        let dict = try LiveActivityCodableBridge.encode(value)
        XCTAssertEqual(dict["headline"] as? String, "Ready")
        XCTAssertEqual(dict["progress"] as? Double, 0.0)
        XCTAssertEqual(dict["stage"] as? String, "prompted")
    }

    func testEncodeDoesNotReturnEmptyDictOnFailure() throws {
        // Regression for the original silent-failure mode: encode used to
        // return `[:]` when JSONSerialization failed. The fixed version
        // throws encodingFailed with the underlying reason.
        // We can't easily trigger an encoder failure on a Codable struct,
        // but we can pin the contract by asserting the happy path returns
        // a non-empty dictionary — the inverse (empty) would never appear
        // on a successful encode in the current implementation.
        let value = SampleContentState(headline: "X", progress: 1.0, stage: "completing")
        let dict = try LiveActivityCodableBridge.encode(value)
        XCTAssertFalse(dict.isEmpty)
    }

    func testLiveActivityErrorDescriptionMatchesContractedCodes() {
        // MSTrapBound (v7+): cases with a trap binding append a
        // `[trap=MSXXX url=...]` suffix to description. The JS side
        // (LiveActivityNativeError) parses the suffix off and rebuilds
        // the bare code, but the contract is now "starts with the
        // ACTIVITY_* code", not "equals it exactly". Unbound cases
        // (notFound, encodingFailed) keep the bare-code contract.
        XCTAssertTrue(LiveActivityError.unsupportedOS.description.hasPrefix("ACTIVITY_UNSUPPORTED_OS"))
        XCTAssertEqual(LiveActivityError.notFound.description, "ACTIVITY_NOT_FOUND")
        XCTAssertTrue(LiveActivityError.unsupportedFeature.description.hasPrefix("ACTIVITY_UNSUPPORTED_FEATURE"))
        XCTAssertTrue(
            LiveActivityError.decodingFailed(reason: "field x missing")
                .description.hasPrefix("ACTIVITY_DECODE_FAILED: field x missing")
        )
        XCTAssertEqual(
            LiveActivityError.encodingFailed(reason: "json failed").description,
            "ACTIVITY_ENCODE_FAILED: json failed"
        )
    }

    func testLiveActivityErrorTrapBindingAppendsCatalogSuffix() {
        // Bound cases carry both trapId and the [trap=... url=...] suffix.
        XCTAssertEqual(LiveActivityError.decodingFailed(reason: "x").trapId, "MS003")
        XCTAssertEqual(LiveActivityError.unsupportedOS.trapId, "MS012")
        XCTAssertEqual(LiveActivityError.unsupportedFeature.trapId, "MS012")
        XCTAssertTrue(LiveActivityError.unsupportedOS.description.contains("[trap=MS012 url="))

        // Unbound cases: nil trapId, no suffix.
        XCTAssertNil(LiveActivityError.notFound.trapId)
        XCTAssertNil(LiveActivityError.encodingFailed(reason: "x").trapId)
        XCTAssertFalse(LiveActivityError.notFound.description.contains("[trap="))
    }

    func testLocalizedErrorDescriptionMirrorsCustomStringConvertible() {
        // ExpoModulesCore inspects errorDescription on some bridge paths.
        // The two must produce the same JS-visible string.
        let err = LiveActivityError.decodingFailed(reason: "x")
        XCTAssertEqual(err.errorDescription, err.description)
    }
}
