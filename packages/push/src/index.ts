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
  SendResponse,
  ChannelInfo,
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
  TooManyRequestsError,
  UnknownApnsError,
  InvalidSnapshotError,
  ClientClosedError,
} from "./errors.ts";
