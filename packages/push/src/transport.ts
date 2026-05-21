// Transport-layer retry classification. These are connection / stream error
// codes raised by Node's net and http2 modules before APNs can return a JSON
// body, so they are a separate concern from the APNs application-level reason
// strings in reasons.ts (which is generated from data/apns-reasons.json).
// Keeping them in their own module is what lets reasons.ts be fully generated.

/**
 * Connection-level errors that are always retryable, regardless of APNs reason
 * (since these arrive before APNs can return a JSON body).
 */
export const RETRYABLE_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "NGHTTP2_REFUSED_STREAM",
  // Node's http2 module reports a session that closed unexpectedly
  // (e.g. peer destroyed the connection or sent GOAWAY+close while a
  // stream was in flight) with this code on the failing stream. Treating
  // it as retryable mirrors the connection-error fallthrough we get for
  // ECONNRESET; the next attempt establishes a fresh session.
  "ERR_HTTP2_SESSION_ERROR",
]);
