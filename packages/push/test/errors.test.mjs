import { test } from "node:test";
import assert from "node:assert/strict";

const {
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
  TooManyRequestsError,
  UnknownApnsError,
  MissingApnsConfigError,
  trapIdForErrorClass,
  TRAP_ID_BY_ERROR_CLASS,
} = await import("../dist/index.js");

const { reasonToError } = await import("../dist/errors.js");

const REASON_TABLE = [
  ["BadDeviceToken", BadDeviceTokenError],
  ["InvalidProviderToken", InvalidProviderTokenError],
  ["ExpiredProviderToken", ExpiredProviderTokenError],
  ["TopicDisallowed", TopicDisallowedError],
  ["Unregistered", UnregisteredError],
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

test("typed errors expose trapId from the generated bindings", () => {
  // These bindings are load-bearing for the harness UI, the diagnose bundle,
  // and any consumer log aggregator. Drift here means the catalog and the
  // runtime disagree about which trap a failure surfaces.
  const expected = [
    [PayloadTooLargeError, "MS011"],
    [BadDeviceTokenError, "MS014"],
    [TooManyRequestsError, "MS015"],
    [TopicDisallowedError, "MS018"],
    [UnregisteredError, "MS020"],
    [MissingApnsConfigError, "MS028"],
  ];
  for (const [Klass, trapId] of expected) {
    const err =
      Klass === MissingApnsConfigError
        ? new MissingApnsConfigError(["keyId"])
        : Klass === TooManyRequestsError
          ? reasonToError("TooManyRequests", { status: 429 })
          : reasonToError(klassToReason(Klass), { status: 400 });
    assert.equal(err.trapId, trapId, `${Klass.name} should map to ${trapId}`);
  }
});

test("unbound error classes return undefined trapId", () => {
  const err = reasonToError("BadPriority", { status: 400 });
  assert.equal(err.trapId, undefined);
});

test("trapIdForErrorClass and TRAP_ID_BY_ERROR_CLASS agree", () => {
  for (const [name, trapId] of Object.entries(TRAP_ID_BY_ERROR_CLASS)) {
    assert.equal(trapIdForErrorClass(name), trapId);
  }
  assert.equal(trapIdForErrorClass("DefinitelyNotAClass"), undefined);
});

function klassToReason(Klass) {
  // The reasonToError table is keyed by APNs reason; recover it from the
  // class name. The reverse map is intentionally local to keep tests
  // independent of the production reason table layout.
  return Klass.name.replace(/Error$/, "");
}
