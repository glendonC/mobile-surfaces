import { test } from "node:test";
import assert from "node:assert/strict";

const {
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
} = await import("../dist/index.js");

const { reasonToError } = await import("../dist/errors.js");

const REASON_TABLE = [
  ["BadDeviceToken", BadDeviceTokenError],
  ["InvalidProviderToken", InvalidProviderTokenError],
  ["ExpiredProviderToken", ExpiredProviderTokenError],
  ["TopicDisallowed", TopicDisallowedError],
  ["PayloadTooLarge", PayloadTooLargeError],
  ["BadPriority", BadPriorityError],
  ["BadExpirationDate", BadExpirationDateError],
  ["BadDate", BadDateError],
  ["MissingTopic", MissingTopicError],
  ["MissingChannelId", MissingChannelIdError],
  ["BadChannelId", BadChannelIdError],
  ["ChannelNotRegistered", ChannelNotRegisteredError],
  ["CannotCreateChannelConfig", CannotCreateChannelConfigError],
  ["InvalidPushType", InvalidPushTypeError],
  ["FeatureNotEnabled", FeatureNotEnabledError],
  ["MissingPushType", MissingPushTypeError],
  ["TooManyRequests", TooManyRequestsError],
];

test("reasonToError maps each documented reason to its typed subclass", () => {
  for (const [reason, Klass] of REASON_TABLE) {
    const err = reasonToError(reason, { status: 400, apnsId: "abc" });
    assert.equal(err.constructor.name, Klass.name, `reason=${reason}`);
    assert.ok(err instanceof Klass, `reason=${reason} instanceof ${Klass.name}`);
    assert.ok(err instanceof ApnsError, `reason=${reason} instanceof ApnsError`);
    assert.equal(err.reason, reason);
    assert.equal(err.status, 400);
    assert.equal(err.apnsId, "abc");
  }
});

test("unknown reasons fall through to UnknownApnsError preserving the raw reason", () => {
  const err = reasonToError("SomethingMadeUp", { status: 400 });
  assert.ok(err instanceof UnknownApnsError);
  assert.equal(err.reason, "SomethingMadeUp");
});

test("TooManyRequestsError carries retryAfterSeconds", () => {
  const err = reasonToError("TooManyRequests", { status: 429, retryAfterSeconds: 12 });
  assert.ok(err instanceof TooManyRequestsError);
  assert.equal(err.retryAfterSeconds, 12);
});
