---
"@mobile-surfaces/push": minor
---

Add a client-side payload size pre-flight for MS011. Both `sendBroadcastUpdate` and the shared activity-send path now call `assertPayloadWithinLimit` after stringifying the APNs body and throw `PayloadTooLargeError` (status 413) when the payload exceeds the 4 KB per-activity ceiling or the 5 KB broadcast ceiling, instead of letting the request round-trip to APNs and come back as a 413. The error message names the actual byte count, the applicable limit, and the operation kind, and cites MS011 so callers can route it to the catalog entry. Callers that previously caught `PayloadTooLargeError` from APNs responses keep working; those that did not now see the same error class surfaced earlier and without burning an APNs round-trip.
