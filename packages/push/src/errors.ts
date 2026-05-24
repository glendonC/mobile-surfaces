// APNs error taxonomy. Every send/manage method returns either a SendResponse
// (or ChannelInfo/void) on 2xx, or throws an ApnsError subclass on non-2xx.
// The mapping from `reason` string → subclass lives in `reasonToError`; new
// reasons should add an entry there and a class below in alphabetical order.

import { APNS_REASON_GUIDE } from "./reasons.ts";
import { MobileSurfacesError } from "@mobile-surfaces/traps";

export interface ApnsErrorInit {
  reason: string;
  status: number;
  apnsId?: string;
  timestamp?: Date;
  message?: string;
}

/**
 * Base class for all APNs-originated errors. Subclasses are thrown for known
 * `reason` strings; `UnknownApnsError` is used for reasons not in the guide.
 *
 * Per-instance fields:
 * - `reason`: Apple's reason string verbatim (e.g. "BadDeviceToken").
 * - `status`: HTTP status from APNs.
 * - `apnsId`: the `apns-id` response header (set on every error for log
 *   correlation).
 * - `timestamp`: when the error was observed (defaults to now).
 * - `trapId`: catalog entry id (MS\d{3}) for the trap this error surfaces, or
 *   undefined when the class has no catalog binding. Resolved off `this.name`
 *   by the `MobileSurfacesError` base class via @mobile-surfaces/traps;
 *   subclasses never hand-stamp it.
 * - `docsUrl`: URL pointing at the rendered catalog entry for this error's
 *   trap, when bound. Operators paste this into a browser to read the fix.
 *   Same lazy lookup as `trapId`; returns undefined for unbound classes.
 */
export class ApnsError extends MobileSurfacesError {
  readonly reason: string;
  readonly status: number;
  readonly apnsId?: string;
  readonly timestamp: Date;

  constructor(init: ApnsErrorInit) {
    const message =
      init.message ??
      formatApnsMessage(init.reason, init.status, init.apnsId);
    super(message);
    this.name = "ApnsError";
    this.reason = init.reason;
    this.status = init.status;
    this.apnsId = init.apnsId;
    this.timestamp = init.timestamp ?? new Date();
  }
}

function formatApnsMessage(reason: string, status: number, apnsId?: string) {
  const guide = APNS_REASON_GUIDE[reason];
  const idSuffix = apnsId ? ` (apns-id: ${apnsId})` : "";
  if (guide) {
    return `APNs ${status} ${reason}: ${guide.cause} Fix: ${guide.fix}${idSuffix}`;
  }
  return `APNs ${status} ${reason}${idSuffix}`;
}

export class BadDeviceTokenError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadDeviceToken" });
    this.name = "BadDeviceTokenError";
  }
}

export class InvalidProviderTokenError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "InvalidProviderToken" });
    this.name = "InvalidProviderTokenError";
  }
}

export class ExpiredProviderTokenError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "ExpiredProviderToken" });
    this.name = "ExpiredProviderTokenError";
  }
}

export class TopicDisallowedError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "TopicDisallowed" });
    this.name = "TopicDisallowedError";
  }
}

/**
 * 410 Unregistered. The token's activity has ended, the user uninstalled the
 * app, or the OS rotated the token (MS020). Backends should discard the token
 * and stop selecting it for sends.
 */
export class UnregisteredError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "Unregistered" });
    this.name = "UnregisteredError";
  }
}

export class PayloadTooLargeError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "PayloadTooLarge" });
    this.name = "PayloadTooLargeError";
  }
}

export class BadPriorityError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadPriority" });
    this.name = "BadPriorityError";
  }
}

export class BadExpirationDateError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadExpirationDate" });
    this.name = "BadExpirationDateError";
  }
}

/**
 * Raised by the SDK's client-side pre-flight (packages/push/src/preflight.ts)
 * when a Live Activity `staleDateSeconds` or `dismissalDateSeconds` is not a
 * finite positive unix-seconds integer. Distinct from
 * `BadExpirationDateError`, which still maps directly to APNs' returned
 * "BadExpirationDate" reason for the `apns-expiration` header. APNs does not
 * return a "BadDate" reason string in its current table; the typed class
 * stays because the pre-flight surfaces the same class of bug before the
 * round-trip, and the `data/apns-reasons.json` entry now carries an
 * `apnsDocumented: false` marker that records the provenance. See MS032.
 */
export class BadDateError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadDate" });
    this.name = "BadDateError";
  }
}

export class MissingTopicError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "MissingTopic" });
    this.name = "MissingTopicError";
  }
}

export class MissingChannelIdError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "MissingChannelId" });
    this.name = "MissingChannelIdError";
  }
}

export class BadChannelIdError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadChannelId" });
    this.name = "BadChannelIdError";
  }
}

export class ChannelNotRegisteredError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "ChannelNotRegistered" });
    this.name = "ChannelNotRegisteredError";
  }
}

export class CannotCreateChannelConfigError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "CannotCreateChannelConfig" });
    this.name = "CannotCreateChannelConfigError";
  }
}

export class InvalidPushTypeError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "InvalidPushType" });
    this.name = "InvalidPushTypeError";
  }
}

export class FeatureNotEnabledError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "FeatureNotEnabled" });
    this.name = "FeatureNotEnabledError";
  }
}

export class MissingPushTypeError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "MissingPushType" });
    this.name = "MissingPushTypeError";
  }
}

// Request-shape and certificate reasons. These complete the typed taxonomy so
// every reason in data/apns-reasons.json maps to a class rather than falling
// through to UnknownApnsError; scripts/check-apns-reason-coverage.mjs gates
// the set. Several (BadPath, MethodNotAllowed, DuplicateHeaders, PayloadEmpty)
// can only originate from an SDK bug with a correct caller, but the catalog is
// only honest if it is exhaustive.

export class BadCollapseIdError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadCollapseId" });
    this.name = "BadCollapseIdError";
  }
}

export class BadMessageIdError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadMessageId" });
    this.name = "BadMessageIdError";
  }
}

export class BadTopicError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadTopic" });
    this.name = "BadTopicError";
  }
}

export class DeviceTokenNotForTopicError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "DeviceTokenNotForTopic" });
    this.name = "DeviceTokenNotForTopicError";
  }
}

export class DuplicateHeadersError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "DuplicateHeaders" });
    this.name = "DuplicateHeadersError";
  }
}

export class IdleTimeoutError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "IdleTimeout" });
    this.name = "IdleTimeoutError";
  }
}

export class MissingDeviceTokenError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "MissingDeviceToken" });
    this.name = "MissingDeviceTokenError";
  }
}

export class PayloadEmptyError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "PayloadEmpty" });
    this.name = "PayloadEmptyError";
  }
}

export class BadCertificateError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadCertificate" });
    this.name = "BadCertificateError";
  }
}

export class BadCertificateEnvironmentError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadCertificateEnvironment" });
    this.name = "BadCertificateEnvironmentError";
  }
}

export class MissingProviderTokenError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "MissingProviderToken" });
    this.name = "MissingProviderTokenError";
  }
}

export class BadPathError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "BadPath" });
    this.name = "BadPathError";
  }
}

export class MethodNotAllowedError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "MethodNotAllowed" });
    this.name = "MethodNotAllowedError";
  }
}

/**
 * 429 TooManyProviderTokenUpdates. The provider JWT is being re-minted too
 * often, typically because a fresh `PushClient` is constructed per send
 * instead of being reused. Distinct from `TooManyRequestsError` (device-token
 * send rate) because the operator response is different: reuse the client.
 */
export class TooManyProviderTokenUpdatesError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "TooManyProviderTokenUpdates" });
    this.name = "TooManyProviderTokenUpdatesError";
  }
}

/**
 * 403 Forbidden. The auth key was revoked. Terminal — no retry helps; the
 * operator must mint a fresh key in the Apple Developer portal and update
 * `keyPath` / `keyId`. Distinguished from `InvalidProviderTokenError` (which
 * is a transient JWT mismatch) because the operational response is different.
 */
export class ForbiddenError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "Forbidden" });
    this.name = "ForbiddenError";
  }
}

/**
 * 500 Internal Server Error from APNs. Transient; included in
 * `DEFAULT_RETRYABLE_REASONS` so the default retry policy retries it.
 * Surfaced as a typed class (rather than `UnknownApnsError`) so observability
 * hooks can discriminate it from other 5xx fallthroughs.
 */
export class InternalServerError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "InternalServerError" });
    this.name = "InternalServerError";
  }
}

/**
 * 503 Service Unavailable from APNs. Transient; included in
 * `DEFAULT_RETRYABLE_REASONS` so the default retry policy retries it.
 * Surfaced as a typed class (rather than `UnknownApnsError`) so observability
 * hooks can discriminate it from other 5xx fallthroughs.
 */
export class ServiceUnavailableError extends ApnsError {
  constructor(init: Omit<ApnsErrorInit, "reason">) {
    super({ ...init, reason: "ServiceUnavailable" });
    this.name = "ServiceUnavailableError";
  }
}

/**
 * 429 Too Many Requests. `retryAfterSeconds` is parsed from the `Retry-After`
 * response header when present; the retry policy honors it instead of the
 * computed exponential backoff.
 */
export class TooManyRequestsError extends ApnsError {
  readonly retryAfterSeconds?: number;

  constructor(init: Omit<ApnsErrorInit, "reason"> & { retryAfterSeconds?: number }) {
    super({ ...init, reason: "TooManyRequests" });
    this.name = "TooManyRequestsError";
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * Fallback for `reason` strings not in the local guide. Preserves the raw
 * reason on the instance so log aggregators can still bucket by it.
 */
export class UnknownApnsError extends ApnsError {
  constructor(init: ApnsErrorInit) {
    super(init);
    this.name = "UnknownApnsError";
  }
}

/**
 * Thrown by `createChannel()` when APNs returns a 2xx response but neither
 * the `apns-channel-id` header nor the body's documented id fields are
 * parseable. Distinct from `ApnsError` because the response was successful
 * at the HTTP layer; the failure is that the SDK cannot recover the channel
 * id the caller needs to drive subsequent broadcasts. Carries the status so
 * observability hooks can correlate, and a short snippet of the body for
 * post-hoc debugging without leaking arbitrarily large responses.
 */
export class CreateChannelResponseError extends MobileSurfacesError {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(status: number, body: string) {
    const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    super(
      `createChannel: APNs returned ${status} but no apns-channel-id was ` +
        `found in headers or body. Body: ${snippet || "<empty>"}.`,
    );
    this.name = "CreateChannelResponseError";
    this.status = status;
    this.bodySnippet = snippet;
  }
}

/**
 * Thrown when an in-flight request is aborted via the optional `signal`
 * option on a send/manage method, or when an already-aborted signal is
 * passed in. The `cause` is the signal's reason (or a fallback Error when
 * the abort was raised without one).
 */
export class AbortError extends MobileSurfacesError {
  constructor(cause?: unknown) {
    super("Request aborted");
    this.name = "AbortError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Thrown when a snapshot fails `liveSurfaceSnapshot.safeParse` or its `kind`
 * is not allowed for the chosen send method (e.g. calling `update()` with a
 * `widget`-kind snapshot). Carries the underlying issue as a string array so
 * callers don't need to depend on Zod to read it.
 */
export class InvalidSnapshotError extends MobileSurfacesError {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = "InvalidSnapshotError";
    this.issues = issues;
  }
}

/**
 * Thrown when any send/manage method is called on a closed `PushClient`.
 */
export class ClientClosedError extends MobileSurfacesError {
  constructor(message = "PushClient has been closed; refusing new requests.") {
    super(message);
    this.name = "ClientClosedError";
  }
}

/**
 * Thrown by `createPushClient` when one or more required config values are
 * missing or empty. The catalog (data/traps.json MS028) promises the SDK
 * "validates presence; rejects fast if any are missing" — this class is the
 * concrete carrier for that contract. `missing` lists the option names that
 * were rejected; the binding to MS028 resolves through the same lazy getter
 * the APNs error classes use.
 */
export class MissingApnsConfigError extends MobileSurfacesError {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    const list = missing.join(", ");
    super(
      `createPushClient: missing required config — ${list}. See data/traps.json MS028.`,
    );
    this.name = "MissingApnsConfigError";
    this.missing = missing;
  }
}

/**
 * Thrown by `createPushClient` when a required config value is present but
 * malformed. Distinct from `MissingApnsConfigError` (absent config): here the
 * value was supplied but cannot be used as-is.
 *
 * The current case (data/traps.json MS018): `bundleId` carries a trailing
 * `.push-type.liveactivity` suffix. The SDK appends that suffix itself when it
 * builds the `apns-topic` for Live Activity pushes, so a pre-suffixed
 * `bundleId` produces a doubled suffix and APNs rejects every send with a
 * 400 TopicDisallowed. Catching it at construction turns a per-send runtime
 * failure into one fast rejection. `field` names the offending option.
 */
export class MalformedApnsConfigError extends MobileSurfacesError {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`createPushClient: ${field} is malformed — ${detail}`);
    this.name = "MalformedApnsConfigError";
    this.field = field;
  }
}

/**
 * Thrown by a send method when the caller passes `tokenEnvironment` and it
 * does not match the environment the `PushClient` was constructed for.
 *
 * APNs push tokens are environment-specific: a token minted by a dev-client
 * or `expo run:ios` build authenticates only against the development APNs
 * host, and a TestFlight / App Store token only against production. Sending a
 * token to the wrong host fails with a 400 `BadDeviceToken` that gives no
 * hint the cause is an environment mismatch (data/traps.json MS014). When the
 * caller threads the token record's stored `environment` through as
 * `tokenEnvironment`, this preflight turns that opaque 400 into a precise
 * pre-send error naming both environments.
 */
export class TokenEnvironmentMismatchError extends MobileSurfacesError {
  readonly tokenEnvironment: string;
  readonly clientEnvironment: string;

  constructor(tokenEnvironment: string, clientEnvironment: string) {
    super(
      `Token environment mismatch: the token was minted for "${tokenEnvironment}" but this PushClient targets "${clientEnvironment}" APNs. A token is only valid against the APNs host of the build that minted it. Route the token to a PushClient constructed with environment: "${tokenEnvironment}", or confirm the stored environment is correct. See data/traps.json MS014.`,
    );
    this.name = "TokenEnvironmentMismatchError";
    this.tokenEnvironment = tokenEnvironment;
    this.clientEnvironment = clientEnvironment;
  }
}

interface ReasonToErrorInit {
  status: number;
  apnsId?: string;
  timestamp?: Date;
  retryAfterSeconds?: number;
}

/**
 * Map an APNs reason string to the appropriate ApnsError subclass. Unknown
 * reasons get UnknownApnsError with the raw reason preserved.
 */
export function reasonToError(reason: string, init: ReasonToErrorInit): ApnsError {
  switch (reason) {
    case "BadDeviceToken":
      return new BadDeviceTokenError(init);
    case "InvalidProviderToken":
      return new InvalidProviderTokenError(init);
    case "ExpiredProviderToken":
      return new ExpiredProviderTokenError(init);
    case "TopicDisallowed":
      return new TopicDisallowedError(init);
    case "Unregistered":
      return new UnregisteredError(init);
    case "PayloadTooLarge":
      return new PayloadTooLargeError(init);
    case "BadPriority":
      return new BadPriorityError(init);
    case "BadExpirationDate":
      return new BadExpirationDateError(init);
    case "BadDate":
      return new BadDateError(init);
    case "MissingTopic":
      return new MissingTopicError(init);
    case "MissingChannelId":
      return new MissingChannelIdError(init);
    case "BadChannelId":
      return new BadChannelIdError(init);
    case "ChannelNotRegistered":
      return new ChannelNotRegisteredError(init);
    case "CannotCreateChannelConfig":
      return new CannotCreateChannelConfigError(init);
    case "InvalidPushType":
      return new InvalidPushTypeError(init);
    case "FeatureNotEnabled":
      return new FeatureNotEnabledError(init);
    case "MissingPushType":
      return new MissingPushTypeError(init);
    case "BadCollapseId":
      return new BadCollapseIdError(init);
    case "BadMessageId":
      return new BadMessageIdError(init);
    case "BadTopic":
      return new BadTopicError(init);
    case "DeviceTokenNotForTopic":
      return new DeviceTokenNotForTopicError(init);
    case "DuplicateHeaders":
      return new DuplicateHeadersError(init);
    case "IdleTimeout":
      return new IdleTimeoutError(init);
    case "MissingDeviceToken":
      return new MissingDeviceTokenError(init);
    case "PayloadEmpty":
      return new PayloadEmptyError(init);
    case "BadCertificate":
      return new BadCertificateError(init);
    case "BadCertificateEnvironment":
      return new BadCertificateEnvironmentError(init);
    case "MissingProviderToken":
      return new MissingProviderTokenError(init);
    case "BadPath":
      return new BadPathError(init);
    case "MethodNotAllowed":
      return new MethodNotAllowedError(init);
    case "TooManyProviderTokenUpdates":
      return new TooManyProviderTokenUpdatesError(init);
    case "Forbidden":
      return new ForbiddenError(init);
    case "InternalServerError":
      return new InternalServerError(init);
    case "ServiceUnavailable":
      return new ServiceUnavailableError(init);
    case "TooManyRequests":
      return new TooManyRequestsError(init);
    default:
      return new UnknownApnsError({ ...init, reason });
  }
}
