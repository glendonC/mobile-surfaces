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
    "--snapshot-file=./data/surface-fixtures/queued.json",
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
    "--snapshot-file=./data/surface-fixtures/active-progress.json",
  ]);
  assert.equal(config.mode, "broadcast");
  assert.equal(config.channelId, "dHN0LXNyY2gtY2hubA==");
  assert.equal(config.env, "development");
  assert.equal(config.snapshotFile, "./data/surface-fixtures/active-progress.json");
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

test("alert mode requires --snapshot-file (no smoke-test fallback)", () => {
  // The old --title/--body default fallback is gone; alert is now snapshot-only.
  // Credential-only validation lives in scripts/setup-apns.mjs.
  expectError(
    ["--device-token=deadbeef"],
    (err) => {
      assert.match(err.message, /--snapshot-file/);
      assert.match(err.message, /surface:setup-apns/);
    },
  );
});

test("alert mode accepts --device-token with --snapshot-file", () => {
  const config = parseAndValidateArgs([
    "--device-token=deadbeef",
    "--snapshot-file=./data/surface-fixtures/queued.json",
  ]);
  assert.equal(config.mode, "device-send");
  assert.equal(config.type, "alert");
  assert.equal(config.token, "deadbeef");
  assert.equal(config.snapshotFile, "./data/surface-fixtures/queued.json");
});

test("liveactivity --activity-token --event=update accepts --snapshot-file", () => {
  const config = parseAndValidateArgs([
    "--activity-token=deadbeef",
    "--type=liveactivity",
    "--event=update",
    "--snapshot-file=./data/surface-fixtures/active-progress.json",
  ]);
  assert.equal(config.mode, "device-send");
  assert.equal(config.type, "liveactivity");
  assert.equal(config.tokenSource, "activity");
  assert.equal(config.event, "update");
});

test("liveactivity send without --snapshot-file fails with setup redirect", () => {
  expectError(
    [
      "--activity-token=deadbeef",
      "--type=liveactivity",
      "--event=update",
    ],
    (err) => {
      assert.match(err.message, /--snapshot-file/);
      assert.match(err.message, /surface:setup-apns/);
    },
  );
});

test("rejects liveactivity send without --activity-token", () => {
  expectError(
    ["--type=liveactivity", "--event=update"],
    (err) => assert.match(err.message, /Missing --activity-token/),
  );
});

test("--print flag sets the print meta on a valid config", () => {
  const config = parseAndValidateArgs([
    "--device-token=deadbeef",
    "--snapshot-file=./data/surface-fixtures/queued.json",
    "--print",
  ]);
  assert.equal(config.print, true);
  assert.equal(config.json, false);
});

test("--describe is treated as an alias for --print", () => {
  const config = parseAndValidateArgs([
    "--device-token=deadbeef",
    "--snapshot-file=./data/surface-fixtures/queued.json",
    "--describe",
  ]);
  assert.equal(config.print, true);
});

test("--json flag sets the json meta on a valid config", () => {
  const config = parseAndValidateArgs([
    "--device-token=deadbeef",
    "--snapshot-file=./data/surface-fixtures/queued.json",
    "--json",
  ]);
  assert.equal(config.json, true);
});

test("--priority accepts 5 or 10, rejects others", () => {
  const p5 = parseAndValidateArgs([
    "--device-token=deadbeef",
    "--snapshot-file=./data/surface-fixtures/queued.json",
    "--priority=5",
  ]);
  assert.equal(p5.priority, 5);

  const p10 = parseAndValidateArgs([
    "--device-token=deadbeef",
    "--snapshot-file=./data/surface-fixtures/queued.json",
    "--priority=10",
  ]);
  assert.equal(p10.priority, 10);

  expectError(
    [
      "--device-token=deadbeef",
      "--snapshot-file=./data/surface-fixtures/queued.json",
      "--priority=7",
    ],
    (err) => assert.match(err.message, /--priority must be 5 or 10/),
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
