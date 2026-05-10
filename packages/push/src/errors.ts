// APNs error taxonomy. Every send/manage method returns either a SendResponse
// (or ChannelInfo/void) on 2xx, or throws an ApnsError subclass on non-2xx.
// The mapping from `reason` string → subclass lives in `reasonToError`; new
// reasons should add an entry there and a class below in alphabetical order.

import { APNS_REASON_GUIDE } from "./reasons.ts";
import { trapIdForErrorClass } from "./trap-bindings.ts";

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
 *   undefined when the class has no catalog binding. Resolved from the live
 *   subclass `name` via the generated trap-bindings table; subclasses never
 *   hand-stamp it.
 */
export class ApnsError extends Error {
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

  // Resolved lazily off `this.name` so subclasses get the right trap id
  // without each constructor having to stamp it. Subclasses set `name` after
  // super() returns; the getter reads the post-assignment value on every
  // access. trapIdForErrorClass returns undefined for unbound classes.
  get trapId(): string | undefined {
    return trapIdForErrorClass(this.name);
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
 * Thrown when a snapshot fails `liveSurfaceSnapshot.safeParse` or its `kind`
 * is not allowed for the chosen send method (e.g. calling `update()` with a
 * `widget`-kind snapshot). Carries the underlying issue as a string array so
 * callers don't need to depend on Zod to read it.
 */
export class InvalidSnapshotError extends Error {
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
export class ClientClosedError extends Error {
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
export class MissingApnsConfigError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    const list = missing.join(", ");
    super(
      `createPushClient: missing required config — ${list}. See data/traps.json MS028.`,
    );
    this.name = "MissingApnsConfigError";
    this.missing = missing;
  }

  get trapId(): string | undefined {
    return trapIdForErrorClass(this.name);
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
    case "TooManyRequests":
      return new TooManyRequestsError(init);
    default:
      return new UnknownApnsError({ ...init, reason });
  }
}
