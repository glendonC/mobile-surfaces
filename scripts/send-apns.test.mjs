// Tests for scripts/send-apns.mjs argument parsing/validation.
// Network and env-checks are covered indirectly: the test only imports the
// pure parseAndValidateArgs function, which never reaches ensureEnv / http2.

import test from "node:test";
import assert from "node:assert/strict";
import { APNS_REASON_GUIDE, parseAndValidateArgs } from "./send-apns.mjs";

function expectError(argv, predicate) {
  let threw = false;
  try {
    parseAndValidateArgs(argv);
  } catch (err) {
    threw = true;
    assert.equal(err.name, "ConfigError", `expected ConfigError, got ${err.name}: ${err.message}`);
    if (predicate) predicate(err);
  }
  assert.ok(threw, `expected parseAndValidateArgs to throw for ${argv.join(" ")}`);
}

test("rejects --push-to-start-token containing non-hex characters", () => {
  expectError(
    [
      "--push-to-start-token=de:ad:be:ef",
      "--type=liveactivity",
      "--event=start",
      "--attributes-file=./scripts/sample-state.json",
    ],
    (err) => assert.match(err.message, /hex-only/),
  );
});

test("accepts a hex-only --push-to-start-token (no separators)", () => {
  const config = parseAndValidateArgs([
    "--push-to-start-token=deadbeefcafe1234",
    "--type=liveactivity",
    "--event=start",
    "--attributes-file=./scripts/sample-state.json",
  ]);
  assert.equal(config.mode, "device-send");
  assert.equal(config.tokenSource, "push-to-start");
  assert.equal(config.event, "start");
  assert.equal(config.token, "deadbeefcafe1234");
});

test("rejects --push-to-start-token with --event=update", () => {
  expectError(
    [
      "--push-to-start-token=deadbeef",
      "--type=liveactivity",
      "--event=update",
    ],
    (err) => assert.match(err.message, /only supports --event=start/),
  );
});

test("rejects --channel-id combined with --device-token", () => {
  expectError(
    [
      "--channel-id=dHN0LXNyY2gtY2hubA==",
      "--device-token=deadbeef",
      "--type=liveactivity",
      "--event=update",
    ],
    (err) => assert.match(err.message, /mutually exclusive with --device-token/),
  );
});

test("rejects --channel-id combined with --activity-token", () => {
  expectError(
    [
      "--channel-id=dHN0LXNyY2gtY2hubA==",
      "--activity-token=deadbeef",
      "--type=liveactivity",
      "--event=update",
    ],
    (err) => assert.match(err.message, /mutually exclusive with --activity-token/),
  );
});

test("rejects --channel-id with --event=start", () => {
  expectError(
    [
      "--channel-id=dHN0LXNyY2gtY2hubA==",
      "--type=liveactivity",
      "--event=start",
    ],
    (err) => assert.match(err.message, /only supports --event=update/),
  );
});

test("rejects --channel-id with --event=end", () => {
  expectError(
    [
      "--channel-id=dHN0LXNyY2gtY2hubA==",
      "--type=liveactivity",
      "--event=end",
    ],
    (err) => assert.match(err.message, /only supports --event=update/),
  );
});

test("accepts --channel-id with --event=update", () => {
  const config = parseAndValidateArgs([
    "--channel-id=dHN0LXNyY2gtY2hubA==",
    "--type=liveactivity",
    "--event=update",
    "--env=development",
  ]);
  assert.equal(config.mode, "broadcast");
  assert.equal(config.channelId, "dHN0LXNyY2gtY2hubA==");
  assert.equal(config.env, "development");
});

test("rejects --channel-action=delete without --channel-id", () => {
  expectError(
    ["--channel-action=delete", "--env=development"],
    (err) => assert.match(err.message, /requires --channel-id/),
  );
});

test("rejects --channel-action=invalid value", () => {
  expectError(
    ["--channel-action=purge"],
    (err) => assert.match(err.message, /must be one of: create, list, delete/),
  );
});

test("accepts --channel-action=create with default storage policy", () => {
  const config = parseAndValidateArgs([
    "--channel-action=create",
    "--env=production",
  ]);
  assert.equal(config.mode, "channel-management");
  assert.equal(config.action, "create");
  assert.equal(config.storagePolicy, "no-storage");
  assert.equal(config.env, "production");
});

test("accepts --channel-action=create with --storage-policy=most-recent-message", () => {
  const config = parseAndValidateArgs([
    "--channel-action=create",
    "--storage-policy=most-recent-message",
  ]);
  assert.equal(config.storagePolicy, "most-recent-message");
});

test("rejects --channel-action=create with bogus --storage-policy", () => {
  expectError(
    ["--channel-action=create", "--storage-policy=forever"],
    (err) => assert.match(err.message, /storage-policy/),
  );
});

test("rejects --channel-action with a stray --device-token", () => {
  expectError(
    ["--channel-action=list", "--device-token=deadbeef"],
    (err) => assert.match(err.message, /mutually exclusive with --device-token/),
  );
});

test("preserves existing alert-mode default", () => {
  const config = parseAndValidateArgs(["--device-token=deadbeef"]);
  assert.equal(config.mode, "device-send");
  assert.equal(config.type, "alert");
  assert.equal(config.token, "deadbeef");
});

test("preserves existing liveactivity --activity-token mode", () => {
  const config = parseAndValidateArgs([
    "--activity-token=deadbeef",
    "--type=liveactivity",
    "--event=update",
  ]);
  assert.equal(config.mode, "device-send");
  assert.equal(config.type, "liveactivity");
  assert.equal(config.tokenSource, "activity");
  assert.equal(config.event, "update");
});

test("rejects liveactivity send without --activity-token", () => {
  expectError(
    ["--type=liveactivity", "--event=update"],
    (err) => assert.match(err.message, /Missing --activity-token/),
  );
});

test("APNS_REASON_GUIDE has the four documented broadcast/channel reasons", () => {
  // Apple "Handling error responses from APNs":
  //   - MissingChannelId, BadChannelId, ChannelNotRegistered (the three
  //     channel-id failure modes; the user task referred to a single
  //     "InvalidChannelId" but Apple separates malformed from missing-from-
  //     registry, so we surface both)
  //   - CannotCreateChannelConfig (max-channels reached; the user task called
  //     this "ChannelLimitExceeded" — Apple's wire string is the one above)
  //   - InvalidPushType (apns-push-type is wrong for channel mode)
  const required = [
    "MissingChannelId",
    "BadChannelId",
    "ChannelNotRegistered",
    "CannotCreateChannelConfig",
    "InvalidPushType",
  ];
  for (const key of required) {
    assert.ok(APNS_REASON_GUIDE[key], `APNS_REASON_GUIDE missing ${key}`);
    assert.equal(typeof APNS_REASON_GUIDE[key].cause, "string");
    assert.equal(typeof APNS_REASON_GUIDE[key].fix, "string");
    assert.ok(APNS_REASON_GUIDE[key].cause.length > 0, `${key}.cause is empty`);
    assert.ok(APNS_REASON_GUIDE[key].fix.length > 0, `${key}.fix is empty`);
  }
});

test("APNS_REASON_GUIDE preserves pre-existing entries", () => {
  for (const key of [
    "BadDeviceToken",
    "InvalidProviderToken",
    "TopicDisallowed",
    "Forbidden",
    "BadPriority",
    "BadExpirationDate",
    "BadDate",
    "MissingTopic",
    "PayloadTooLarge",
    "ExpiredProviderToken",
    "TooManyRequests",
  ]) {
    assert.ok(APNS_REASON_GUIDE[key], `APNS_REASON_GUIDE missing pre-existing ${key}`);
  }
});
