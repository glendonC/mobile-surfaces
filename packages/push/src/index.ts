// Public surface for @mobile-surfaces/push. Anything not re-exported here is
// implementation detail and may change without a version bump. The shape was
// frozen in Round 0; do not extend without a corresponding changeset.

export {
  PushClient,
  createPushClient,
  TEST_TRANSPORT_OVERRIDE,
  __resetRetryPolicyDeprecationLatch,
} from "./client.ts";
export type {
  CreatePushClientOptions,
  SendOptions,
  BroadcastOptions,
  LiveActivityStartOptions,
  PushResult,
  RetryEvent,
  SendResponse,
  DescribedSend,
  DescribeSendOperation,
  ChannelInfo,
  PushHooks,
  PushHookContext,
  PushHookOperation,
} from "./client.ts";

export type { RetryPolicy } from "./retry.ts";
export { DEFAULT_RETRY_POLICY } from "./retry.ts";

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
} from "./errors.ts";

export {
  TRAP_ID_BY_ERROR_CLASS,
  trapIdForErrorClass,
  DOCS_PATH_BY_ERROR_CLASS,
  DEFAULT_DOCS_BASE_URL,
  FALLBACK_DOCS_PATH,
  docsUrlForErrorClass,
} from "./trap-bindings.ts";
export type { TrapBoundErrorClassName } from "./trap-bindings.ts";

// Re-exports from @mobile-surfaces/surface-contracts so an agent that catches
// an ApnsError can resolve its full trap entry with one import. Without these
// re-exports, a consumer would need to depend on both packages just to map
// error.trapId -> catalog entry.
export {
  traps,
  findTrap,
  findTrapByErrorClass,
} from "@mobile-surfaces/surface-contracts";
export type { TrapEntry } from "@mobile-surfaces/surface-contracts";
