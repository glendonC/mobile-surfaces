// Public surface for @mobile-surfaces/push. Anything not re-exported here is
// implementation detail and may change without a version bump. The shape was
// frozen in Round 0; do not extend without a corresponding changeset.

export {
  PushClient,
  createPushClient,
  TEST_TRANSPORT_OVERRIDE,
} from "./client.ts";
export type {
  CreatePushClientOptions,
  SendOptions,
  BroadcastOptions,
  LiveActivityStartOptions,
  PushResult,
  RetryAttempt,
  SendResponse,
  ChannelInfo,
  PushHooks,
  PushHookContext,
  PushHookOperation,
  DescribeSendInput,
  SendDescription,
} from "./client.ts";

export { JwtCache } from "./jwt.ts";
export type { JwtCacheLike, JwtCacheEntry, JwtConfig } from "./jwt.ts";

export type { RetryPolicy } from "./retry.ts";
export {
  DEFAULT_RETRY_POLICY,
  effectiveRetryPolicy,
  computeBackoffMs,
} from "./retry.ts";

export { APNS_REASON_GUIDE } from "./reasons.ts";
export type { ApnsReasonGuideEntry } from "./reasons.ts";

export {
  ApnsError,
  BadDeviceTokenError,
  InvalidProviderTokenError,
  ExpiredProviderTokenError,
  TopicDisallowedError,
  UnregisteredError,
  PayloadTooLargeError,
  BadPriorityError,
  BadExpirationDateError,
  BadDateError,
  MissingTopicError,
  MissingChannelIdError,
  BadChannelIdError,
  ChannelNotRegisteredError,
  CannotCreateChannelConfigError,
  InvalidPushTypeError,
  FeatureNotEnabledError,
  MissingPushTypeError,
  ForbiddenError,
  InternalServerError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnknownApnsError,
  InvalidSnapshotError,
  ClientClosedError,
  MissingApnsConfigError,
  CreateChannelResponseError,
  AbortError,
} from "./errors.ts";

// Trap binding helpers are now sourced from @mobile-surfaces/traps (the
// single home for the catalog, error base, and Swift bindings as of v7).
// The push package re-exports the runtime-reachable subset so existing
// consumers keep their imports working without forcing a dep change. The
// extra-narrow shapes (TRAP_ID_BY_ERROR_CLASS, BoundTrapId,
// TrapBoundErrorClassName) were package-private in v6 and have no
// equivalent in the new package; they are removed here. If a consumer
// was relying on them, the upgrade path is to import the equivalents
// directly from @mobile-surfaces/traps.
export {
  TRAP_BINDINGS,
  docsUrlForErrorClass,
  findTrap,
  findTrapByErrorClass,
  trapIdForErrorClass,
} from "@mobile-surfaces/traps";
export type { TrapBinding } from "@mobile-surfaces/traps";

export {
  liveActivityAlertPayload,
  toApnsAlertPayload,
} from "./payloads.ts";
export type { LiveActivityAlertPayload } from "./payloads.ts";
