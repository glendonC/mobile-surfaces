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
  ForbiddenError,
  trapIdForErrorClass,
  TRAP_BINDINGS,
  docsUrlForErrorClass,
  findTrap,
  findTrapByErrorClass,
} = await import("../dist/index.js");

// v7: ERROR_CLASS_TO_TRAP_ID is now exposed by @mobile-surfaces/traps
// (the single home for the catalog). The push package re-exports the
// helpers but not the raw object, so tests reach for it directly. The
// shape (Record<className, MSXXX>) is unchanged.
const { ERROR_CLASS_TO_TRAP_ID } = await import("@mobile-surfaces/traps");

const { reasonToError } = await import("../dist/errors.js");

const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");

// data/apns-reasons.json is the source of truth for the reason set: the same
// file generate-apns-reasons.mjs renders into reasons.ts and
// check-apns-reason-coverage.mjs gates errors.ts against. Driving the test
// from it means a reason added to the catalog cannot be silently left without
// behavioral coverage here.
const apnsReasons = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../data/apns-reasons.json", import.meta.url)),
    "utf8",
  ),
).reasons;

// Class name for a reason: `<Reason>Error`, unless the reason already ends in
// "Error" (InternalServerError), where the class name is the reason verbatim.
function classNameFor(reason) {
  return reason.endsWith("Error") ? reason : `${reason}Error`;
}

test("reasonToError maps every reason in data/apns-reasons.json to a typed subclass", () => {
  assert.ok(apnsReasons.length > 0, "expected a non-empty reason catalog");
  for (const { reason } of apnsReasons) {
    const err = reasonToError(reason, { status: 400, apnsId: "abc" });
    assert.ok(err instanceof ApnsError, `reason=${reason} instanceof ApnsError`);
    assert.notEqual(
      err.constructor.name,
      "UnknownApnsError",
      `reason=${reason} falls through to UnknownApnsError instead of a typed subclass`,
    );
    assert.equal(
      err.constructor.name,
      classNameFor(reason),
      `reason=${reason} should map to ${classNameFor(reason)}`,
    );
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
    [ExpiredProviderTokenError, "MS030"],
    [ForbiddenError, "MS030"],
    [InvalidProviderTokenError, "MS030"],
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

test("trapIdForErrorClass and ERROR_CLASS_TO_TRAP_ID agree", () => {
  for (const [name, trapId] of Object.entries(ERROR_CLASS_TO_TRAP_ID)) {
    assert.equal(trapIdForErrorClass(name), trapId);
  }
  assert.equal(trapIdForErrorClass("DefinitelyNotAClass"), undefined);
});

test("typed errors expose docsUrl from the generated bindings", () => {
  const err = reasonToError("PayloadTooLarge", { status: 413 });
  assert.equal(
    err.docsUrl,
    "https://github.com/glendonC/mobile-surfaces/blob/main/AGENTS.md#ms011-activitykit-payload-size-ceiling-4-kb-5-kb-broadcast",
  );
  // MissingApnsConfigError is bound to MS028 but is not an APNs-response
  // error; it still needs to carry the doc pointer for the createPushClient
  // throw path.
  const cfg = new MissingApnsConfigError(["keyId"]);
  assert.equal(
    cfg.docsUrl,
    "https://github.com/glendonC/mobile-surfaces/blob/main/AGENTS.md#ms028-apns-auth-key-environment-variables-must-be-set-before-sending",
  );
});

test("unbound error classes return undefined docsUrl", () => {
  const err = reasonToError("BadPriority", { status: 400 });
  assert.equal(err.docsUrl, undefined);
});

test("findTrap and findTrapByErrorClass surface full bindings", () => {
  const direct = findTrap("MS011");
  assert.ok(direct, "MS011 should be findable");
  assert.equal(direct.id, "MS011");
  assert.equal(direct.severity, "error");
  assert.ok(direct.title.length > 0);
  assert.ok(direct.fix.length > 0);
  assert.ok(direct.docsUrl.startsWith("https://github.com/"));

  const viaClass = findTrapByErrorClass("PayloadTooLargeError");
  assert.deepEqual(viaClass, direct, "lookup paths should converge");

  assert.equal(findTrap("MS999"), undefined);
  assert.equal(findTrapByErrorClass("UnboundError"), undefined);
});

test("TRAP_BINDINGS covers every bound error class", () => {
  // Every id surfaced through ERROR_CLASS_TO_TRAP_ID must resolve to a full
  // binding — otherwise an error's docsUrl getter would silently return
  // undefined even though the trapId is known. TRAP_BINDINGS is a Map in
  // v7 (was an object in v6); accessor is .get().
  for (const trapId of new Set(Object.values(ERROR_CLASS_TO_TRAP_ID))) {
    assert.ok(
      TRAP_BINDINGS.get(trapId),
      `TRAP_BINDINGS missing entry for ${trapId}`,
    );
  }
});

test("docsUrlForErrorClass equals findTrapByErrorClass(name).docsUrl", () => {
  for (const name of Object.keys(ERROR_CLASS_TO_TRAP_ID)) {
    assert.equal(docsUrlForErrorClass(name), findTrapByErrorClass(name).docsUrl);
  }
  assert.equal(docsUrlForErrorClass("UnboundError"), undefined);
});

function klassToReason(Klass) {
  // The reasonToError table is keyed by APNs reason; recover it from the
  // class name. The reverse map is intentionally local to keep tests
  // independent of the production reason table layout.
  return Klass.name.replace(/Error$/, "");
}
