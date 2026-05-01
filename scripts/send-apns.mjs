#!/usr/bin/env node
// Send a push to APNs from the local machine. Six modes:
//   --type=alert                         regular notification (apns-push-type=alert)
//   --type=liveactivity --activity-token=…       ActivityKit start/update/end on an existing activity
//   --type=liveactivity --push-to-start-token=…  iOS 17.2+ remote start via push-to-start token (event=start only)
//   --type=liveactivity --channel-id=…           iOS 18 broadcast push on a channel (event=update only)
//   --channel-action=create|list|delete          iOS 18 channel management (separate host+port, not /3/device)
//
// Env (load from .env.local or shell):
//   APNS_KEY_PATH        path to the .p8 APNs auth key
//   APNS_KEY_ID          10-char key id from Apple Dev portal
//   APNS_TEAM_ID         10-char team id
//   APNS_BUNDLE_ID       e.g. com.example.mobilesurfaces
//
// Send-mode usage (POST /3/device/<token> on api{,.development}.push.apple.com:443):
//   node scripts/send-apns.mjs --device-token=<hex> --type=alert --env=development
//   node scripts/send-apns.mjs --activity-token=<hex> --type=liveactivity \
//     --event=update --snapshot-file=./data/surface-fixtures/active-progress.json --env=development
//   node scripts/send-apns.mjs --push-to-start-token=<hex> --type=liveactivity \
//     --event=start --attributes-file=./data/example-attributes.json --env=development
//
// `device-token` is the APNs device token (regular pushes).
// `activity-token` is the per-activity push token (`Activity.pushTokenUpdates`)
//   for an existing Live Activity. Use for --event=update or --event=end and
//   for --event=start when you have a pre-rotated activity-side token.
// `push-to-start-token` is the app-wide push-to-start token from
//   `Activity<…>.pushToStartTokenUpdates` (iOS 17.2+). Use only with
//   --event=start. The HTTP path stays /3/device/<token>; the difference is
//   solely which token your provider has on hand at request time.
//   Caveat (FB21158660): a push-to-start token issued before the user
//   force-quits the app remains valid against APNs but the OS will not
//   actually start the activity until the user re-launches the app at least
//   once. Plan rollouts and customer-support scripts accordingly.
//
// Live Activity events (for --activity-token / --push-to-start-token modes):
//   --event=start    iOS 17.2+ remote start. Requires --attributes-file with
//                    surfaceId and modeLabel; defaults --attributes-type to
//                    MobileSurfacesActivityAttributes (override after rename).
//   --event=update   ActivityKit content update.
//   --event=end      End the activity. Sets dismissal-date to now unless
//                    --dismissal-date is passed.
//
// Channel broadcast usage (POST /4/broadcasts/apps/<bundle-id> on the standard
// APNs host — broadcast lives on a different path, not a different domain):
//   node scripts/send-apns.mjs --type=liveactivity --channel-id=<base64> \
//     --event=update --snapshot-file=./data/surface-fixtures/active-progress.json --env=development
// Channels only support event=update; start/end are rejected before connect.
// No apns-topic header is sent — broadcast routing uses the bundle-id in the
// path. apns-channel-id is required.
//
// Channel management usage (api-manage-broadcast{,.sandbox}.push.apple.com:
// port 2195 sandbox, 2196 production — verified against Apple's "Sending
// channel management requests to APNs" doc, Sept-2024 revision):
//   node scripts/send-apns.mjs --channel-action=create --env=development [--storage-policy=no-storage|most-recent-message]
//   node scripts/send-apns.mjs --channel-action=list   --env=development
//   node scripts/send-apns.mjs --channel-action=delete --channel-id=<base64> --env=development
// Channel-management responses are printed in a compact form, not the
// "HTTP / Topic / Push-type / Payload" footer used for sends — that footer
// would be misleading for management traffic.
//
// `--stale-date=<unix-seconds>` and `--dismissal-date=<unix-seconds>` map
// directly to the APNs `stale-date` and `dismissal-date` aps fields.
//
// `--priority` overrides apns-priority. Defaults: 5 for liveactivity (Apple
// rate-limits priority 10 aggressively), 10 for alert. Use 10 only when the
// update must be visible immediately.

import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  assertSnapshot,
  toAlertPayload,
  toLiveActivityContentState,
} from "../packages/surface-contracts/src/index.ts";

// Apple's APNs returns a JSON body with a `reason` enum on every non-2xx.
// docs/troubleshooting.md (#31-44) maps these to causes; mirror the table here
// so the script can print a fix below the raw Body line without making the
// user switch tabs. Keep the raw Body intact for transcript fidelity.
//
// Channel/broadcast reason strings (BadChannelId, ChannelNotRegistered,
// MissingChannelId, CannotCreateChannelConfig, InvalidPushType) verified
// against Apple's "Handling error responses from APNs" doc:
// https://developer.apple.com/documentation/usernotifications/handling-error-responses-from-apns
// Two of these (BadChannelId, ChannelNotRegistered) replace the placeholder
// "InvalidChannelId" name that's been circulating in third-party blog posts —
// Apple separates "malformed/oversized" from "doesn't exist". Likewise the
// max-channels error is "CannotCreateChannelConfig", not "ChannelLimitExceeded".
export const APNS_REASON_GUIDE = {
  BadDeviceToken: {
    cause: "Token / environment mismatch.",
    fix: "Use --env=development for dev-client / expo run:ios builds, --env=production only for TestFlight / App Store builds. Tokens from one environment do not authenticate against the other.",
  },
  InvalidProviderToken: {
    cause: "JWT was rejected by APNs.",
    fix: "Confirm APNS_KEY_ID (10 chars), APNS_TEAM_ID (10 chars), and the .p8 at APNS_KEY_PATH all match the same auth key in the Apple Developer portal. JWTs are also rejected when local clock skew exceeds ~1 hour — sync system time.",
  },
  TopicDisallowed: {
    cause: "Auth key is not enabled for this bundle id, or APNS_BUNDLE_ID does not match apps/mobile/app.json's expo.ios.bundleIdentifier.",
    fix: "For Live Activity pushes, the topic is automatically suffixed with .push-type.liveactivity. Do not include that suffix in APNS_BUNDLE_ID itself.",
  },
  Forbidden: {
    cause: "Auth key was revoked.",
    fix: "Generate a new APNs auth key in the Apple Developer portal and update APNS_KEY_PATH / APNS_KEY_ID.",
  },
  BadPriority: {
    cause: "Priority is not 5 or 10.",
    fix: "Use --priority=5 (default for Live Activity) or --priority=10 (immediate user-visible).",
  },
  BadExpirationDate: {
    cause: "--stale-date or apns-expiration is malformed.",
    fix: "Pass a positive unix-seconds integer. The script validates --stale-date and --dismissal-date locally, so this usually means clock skew or a stale state file. For broadcast on a No-Message-Stored channel, apns-expiration must be 0 — Apple rejects nonzero expirations there.",
  },
  BadDate: {
    cause: "A timestamp field is malformed.",
    fix: "Same as BadExpirationDate — confirm --stale-date / --dismissal-date are unix-seconds integers.",
  },
  MissingTopic: {
    cause: "apns-topic header missing or wrong format.",
    fix: "Set APNS_BUNDLE_ID to your bundle identifier (without .push-type.liveactivity suffix; the script appends it).",
  },
  PayloadTooLarge: {
    cause: "ActivityKit payload exceeded 4 KB (5 KB for broadcast).",
    fix: "Trim --state-file or --snapshot-file. Per-activity payloads are bounded at 4 KB; broadcast payloads at 5 KB.",
  },
  ExpiredProviderToken: {
    cause: "JWT is older than 1 hour and APNs rejected it.",
    fix: "JWTs are minted per script run with iat=now; this usually means system clock skew. Sync NTP and retry.",
  },
  TooManyRequests: {
    cause: "Apple is rate-limiting your bundle id (or the Live Activity priority budget is exhausted).",
    fix: "Back off. Live Activity priority 10 has aggressive budgets — drop to 5 unless the update is user-visible.",
  },
  // Channel / broadcast reasons. Strings copied verbatim from Apple's
  // "Handling error responses from APNs" doc table.
  MissingChannelId: {
    cause: "The apns-channel-id header is missing.",
    fix: "Pass --channel-id=<base64> for broadcast sends and channel-action=delete. The header is set automatically when the flag is provided.",
  },
  BadChannelId: {
    cause: "The apns-channel-id header isn't properly encoded, or it's greater than the allowed length.",
    fix: "Channel IDs are base64-encoded strings returned by --channel-action=create. Don't truncate, URL-decode, or re-encode them; pass the value through as-is.",
  },
  ChannelNotRegistered: {
    cause: "The apns-channel-id header used in the request doesn't exist.",
    fix: "Channels are environment-scoped — a channel created with --env=development cannot be reached with --env=production, and vice versa. Re-create the channel in the target environment, or list with --channel-action=list to confirm it exists.",
  },
  InvalidPushType: {
    cause: "The apns-push-type attribute is set to an incorrect value. The only allowed value is LiveActivity (for channels).",
    fix: "For broadcast/channel sends the script always sets apns-push-type=liveactivity. If you reach this from a custom payload, drop the override.",
  },
  CannotCreateChannelConfig: {
    cause: "You have reached the maximum channel limit for your application.",
    fix: "Apple allows up to 10,000 channels per app per environment. Use --channel-action=list to audit, then --channel-action=delete on stale channels before creating new ones.",
  },
  FeatureNotEnabled: {
    cause: "Broadcast capability is not enabled for this bundle id.",
    fix: "Enable broadcast for the auth key in the Apple Developer portal (Certificates, Identifiers & Profiles > Keys). The capability is per-key, not per-app.",
  },
  MissingPushType: {
    cause: "The apns-push-type header is missing.",
    fix: "The script sets this automatically; if you see this from a custom payload, restore --type=liveactivity.",
  },
};

// Format a millisecond skew as "Nm Ss" for human-readable output.
function formatSkew(ms) {
  const totalSeconds = Math.round(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

const REQUIRED_ENV = ["APNS_KEY_PATH", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID"];

// CLI option spec is shared between parse-time validation (importable, used by
// tests) and the run-time send/manage path.
const PARSE_OPTIONS = {
  "device-token": { type: "string" },
  "activity-token": { type: "string" },
  "push-to-start-token": { type: "string" },
  "channel-id": { type: "string" },
  "channel-action": { type: "string" },
  "storage-policy": { type: "string", default: "no-storage" },
  type: { type: "string", default: "alert" },
  env: { type: "string", default: "development" },
  event: { type: "string", default: "update" },
  "snapshot-file": { type: "string" },
  "state-file": { type: "string" },
  "attributes-file": { type: "string" },
  "attributes-type": {
    type: "string",
    default: "MobileSurfacesActivityAttributes",
  },
  "stale-date": { type: "string" },
  "dismissal-date": { type: "string" },
  title: { type: "string", default: "Mobile Surfaces" },
  body: { type: "string", default: "Push path is wired." },
  priority: { type: "string" },
};

// Hex-only validation for tokens that travel in URL paths (device,
// activity, push-to-start). APNs tokens are 64-hex-char lowercase strings —
// we accept any non-empty hex run because Apple has occasionally widened the
// length and we don't want to false-reject a legitimate token.
const HEX_TOKEN_PATTERN = /^[0-9a-fA-F]+$/;

class ConfigError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "ConfigError";
    this.exitCode = exitCode;
  }
}

function parseUnixSeconds(raw, label) {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ConfigError(
      `${label} must be a positive integer unix timestamp in seconds (got ${JSON.stringify(raw)})`,
    );
  }
  return n;
}

// Parse argv and validate flag combinations. Throws ConfigError on any user
// mistake (missing required flag, conflicting modes, malformed token). Returns
// a normalized config object describing the operation. Pure — no I/O, no
// network. Exposed so the test file can exercise validation without invoking
// the script.
export function parseAndValidateArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: PARSE_OPTIONS,
    strict: true,
  });

  // Mode selection precedence: channel-action > channel-id > push-to-start >
  // activity > device. Each subsequent mode also checks no earlier mode's
  // token was passed alongside it, so a stray --device-token doesn't sneak
  // through silently.
  const modeFlags = [
    ["channel-action", values["channel-action"]],
    ["channel-id", values["channel-id"]],
    ["push-to-start-token", values["push-to-start-token"]],
    ["activity-token", values["activity-token"]],
    ["device-token", values["device-token"]],
  ].filter(([, v]) => v !== undefined && v !== "");

  if (values["channel-action"] !== undefined) {
    return validateChannelManagement(values, modeFlags);
  }

  if (values["channel-id"] !== undefined) {
    return validateBroadcast(values, modeFlags);
  }

  if (values["push-to-start-token"] !== undefined) {
    return validatePushToStart(values, modeFlags);
  }

  return validateDeviceSend(values);
}

function validateChannelManagement(values, modeFlags) {
  const action = values["channel-action"];
  if (!["create", "list", "delete"].includes(action)) {
    throw new ConfigError(
      `--channel-action must be one of: create, list, delete (got ${JSON.stringify(action)})`,
    );
  }

  // Reject token combinations that don't apply to management.
  for (const [name] of modeFlags) {
    if (name === "channel-action") continue;
    if (name === "channel-id" && action === "delete") continue;
    throw new ConfigError(
      `--channel-action=${action} is mutually exclusive with --${name}.`,
    );
  }

  if (action === "delete" && !values["channel-id"]) {
    throw new ConfigError("--channel-action=delete requires --channel-id=<base64>");
  }

  if (action === "create") {
    if (!["no-storage", "most-recent-message"].includes(values["storage-policy"])) {
      throw new ConfigError(
        `--storage-policy must be one of: no-storage, most-recent-message (got ${JSON.stringify(values["storage-policy"])})`,
      );
    }
  }

  if (!["development", "production"].includes(values.env)) {
    throw new ConfigError(
      `--env must be one of: development, production (got ${JSON.stringify(values.env)})`,
    );
  }

  return {
    mode: "channel-management",
    action,
    env: values.env,
    channelId: values["channel-id"],
    storagePolicy: values["storage-policy"],
  };
}

function validateBroadcast(values, modeFlags) {
  // channel-id mode: the only other token allowed in the flag set is
  // channel-id itself.
  for (const [name] of modeFlags) {
    if (name === "channel-id") continue;
    throw new ConfigError(
      `--channel-id is mutually exclusive with --${name}.`,
    );
  }

  if (values.type !== "liveactivity") {
    throw new ConfigError(
      "--channel-id requires --type=liveactivity (broadcast push only supports Live Activity payloads).",
    );
  }

  if (values.event !== "update") {
    throw new ConfigError(
      `--channel-id only supports --event=update (channels can't issue start/end). Got --event=${values.event}.`,
    );
  }

  if (!["development", "production"].includes(values.env)) {
    throw new ConfigError(
      `--env must be one of: development, production (got ${JSON.stringify(values.env)})`,
    );
  }

  return {
    mode: "broadcast",
    env: values.env,
    channelId: values["channel-id"],
    snapshotFile: values["snapshot-file"],
    stateFile: values["state-file"],
    staleDate: parseUnixSeconds(values["stale-date"], "--stale-date"),
    priority: values.priority,
  };
}

function validatePushToStart(values, modeFlags) {
  for (const [name] of modeFlags) {
    if (name === "push-to-start-token") continue;
    throw new ConfigError(
      `--push-to-start-token is mutually exclusive with --${name}.`,
    );
  }

  if (values.type !== "liveactivity") {
    throw new ConfigError(
      "--push-to-start-token requires --type=liveactivity.",
    );
  }

  if (values.event !== "start") {
    throw new ConfigError(
      `--push-to-start-token only supports --event=start (got --event=${values.event}). For update/end use --activity-token.`,
    );
  }

  if (!HEX_TOKEN_PATTERN.test(values["push-to-start-token"])) {
    throw new ConfigError(
      "--push-to-start-token must be hex-only (no colons, dashes, or spaces). Strip separators before passing.",
    );
  }

  if (!values["attributes-file"]) {
    throw new ConfigError(
      "--event=start requires --attributes-file with surfaceId and modeLabel",
    );
  }

  return {
    mode: "device-send",
    type: "liveactivity",
    event: "start",
    token: values["push-to-start-token"],
    tokenSource: "push-to-start",
    env: values.env,
    snapshotFile: values["snapshot-file"],
    stateFile: values["state-file"],
    attributesFile: values["attributes-file"],
    attributesType: values["attributes-type"],
    staleDate: parseUnixSeconds(values["stale-date"], "--stale-date"),
    dismissalDate: parseUnixSeconds(values["dismissal-date"], "--dismissal-date"),
    priority: values.priority,
    title: values.title,
    body: values.body,
  };
}

function validateDeviceSend(values) {
  const isLiveActivity = values.type === "liveactivity";
  const tokenFlag = isLiveActivity ? "activity-token" : "device-token";
  const token = values[tokenFlag];
  if (!token) {
    throw new ConfigError(`Missing --${tokenFlag}`);
  }

  if (isLiveActivity && !["start", "update", "end"].includes(values.event)) {
    throw new ConfigError(
      `--event must be one of: start, update, end (got ${JSON.stringify(values.event)})`,
    );
  }

  if (isLiveActivity && values.event === "start" && !values["attributes-file"]) {
    throw new ConfigError(
      "--event=start requires --attributes-file with surfaceId and modeLabel",
    );
  }

  return {
    mode: "device-send",
    type: isLiveActivity ? "liveactivity" : "alert",
    event: isLiveActivity ? values.event : undefined,
    token,
    tokenSource: isLiveActivity ? "activity" : "device",
    env: values.env,
    snapshotFile: values["snapshot-file"],
    stateFile: values["state-file"],
    attributesFile: values["attributes-file"],
    attributesType: values["attributes-type"],
    staleDate: parseUnixSeconds(values["stale-date"], "--stale-date"),
    dismissalDate: parseUnixSeconds(values["dismissal-date"], "--dismissal-date"),
    priority: values.priority,
    title: values.title,
    body: values.body,
  };
}

// Resolve the standard APNs send-host (used for /3/device/<token> and
// /4/broadcasts/apps/<bundle-id>) for the chosen environment.
function sendHost(env) {
  return env === "production" ? "api.push.apple.com" : "api.development.push.apple.com";
}

// Resolve the channel-management host+port. Apple uses a separate domain and
// non-standard ports for management traffic — verified against
// https://developer.apple.com/documentation/usernotifications/sending-channel-management-requests-to-apns
// (Establish a connection with APNs section): sandbox uses
// `api-manage-broadcast.sandbox.push.apple.com:2195`, production uses
// `api-manage-broadcast.push.apple.com:2196`.
function manageHost(env) {
  return env === "production"
    ? { host: "api-manage-broadcast.push.apple.com", port: 2196 }
    : { host: "api-manage-broadcast.sandbox.push.apple.com", port: 2195 };
}

function base64Url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeJwt(keyPem, keyId, teamId) {
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = crypto
    .createSign("SHA256")
    .update(signingInput)
    .sign({ key: keyPem, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64Url(sig)}`;
}

function readSnapshotFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const { $schema: _schema, ...snapshot } = raw;
  return assertSnapshot(snapshot);
}

function buildAlertPayload(config) {
  const snapshot = config.snapshotFile ? readSnapshotFile(config.snapshotFile) : null;
  return snapshot
    ? toAlertPayload(snapshot)
    : {
        aps: {
          alert: { title: config.title, body: config.body },
          sound: "default",
        },
        liveSurface: { kind: "smoke_test" },
      };
}

function buildLiveActivityPayload(config, { includeAttributes }) {
  let contentState = JSON.parse(
    fs.readFileSync(path.resolve("./scripts/sample-state.json"), "utf8"),
  );
  if (config.snapshotFile) {
    contentState = toLiveActivityContentState(readSnapshotFile(config.snapshotFile));
  }
  if (config.stateFile) {
    contentState = JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
  }

  const aps = {
    timestamp: Math.floor(Date.now() / 1000),
    event: config.event,
    "content-state": contentState,
  };

  if (includeAttributes && config.event === "start") {
    const attrSource = JSON.parse(fs.readFileSync(config.attributesFile, "utf8"));
    if (typeof attrSource.surfaceId !== "string" || typeof attrSource.modeLabel !== "string") {
      throw new ConfigError(
        `--attributes-file ${config.attributesFile} must include string fields surfaceId and modeLabel`,
      );
    }
    aps["attributes-type"] = config.attributesType;
    aps.attributes = {
      surfaceId: attrSource.surfaceId,
      modeLabel: attrSource.modeLabel,
    };
  }

  if (config.staleDate !== undefined) aps["stale-date"] = config.staleDate;

  if (config.event === "end") {
    aps["dismissal-date"] = config.dismissalDate ?? Math.floor(Date.now() / 1000);
  } else if (config.dismissalDate !== undefined) {
    aps["dismissal-date"] = config.dismissalDate;
  }

  return { aps };
}

function buildBroadcastPayload(config) {
  // Broadcast is always an update — start/end were rejected at parse time.
  let contentState = JSON.parse(
    fs.readFileSync(path.resolve("./scripts/sample-state.json"), "utf8"),
  );
  if (config.snapshotFile) {
    contentState = toLiveActivityContentState(readSnapshotFile(config.snapshotFile));
  }
  if (config.stateFile) {
    contentState = JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
  }

  const aps = {
    timestamp: Math.floor(Date.now() / 1000),
    event: "update",
    "content-state": contentState,
  };
  if (config.staleDate !== undefined) aps["stale-date"] = config.staleDate;
  return { aps };
}

function buildDeviceHeaders(config, jwt, bundleId) {
  const isLiveActivity = config.type === "liveactivity";
  const apnsTopic = isLiveActivity
    ? `${bundleId}.push-type.liveactivity`
    : bundleId;
  const priority = config.priority ?? (isLiveActivity ? "5" : "10");
  const headers = {
    ":method": "POST",
    ":path": `/3/device/${config.token}`,
    authorization: `bearer ${jwt}`,
    "apns-topic": apnsTopic,
    "apns-push-type": isLiveActivity ? "liveactivity" : "alert",
    "apns-priority": priority,
    "content-type": "application/json",
  };
  if (isLiveActivity) {
    headers["apns-expiration"] = String(Math.floor(Date.now() / 1000) + 3600);
  }
  return headers;
}

function buildBroadcastHeaders(config, jwt, bundleId) {
  // Apple "Sending broadcast push notification requests to APNs" doc:
  // path is /4/broadcasts/apps/<bundle ID>, no apns-topic, channel id in
  // apns-channel-id header, push-type liveactivity. apns-expiration is
  // required; the script sets 0 for No-Storage compatibility.
  const priority = config.priority ?? "5";
  return {
    ":method": "POST",
    ":path": `/4/broadcasts/apps/${bundleId}`,
    authorization: `bearer ${jwt}`,
    "apns-channel-id": config.channelId,
    "apns-push-type": "liveactivity",
    "apns-priority": priority,
    "apns-expiration": "0",
    "content-type": "application/json",
  };
}

// Translate a CLI-friendly storage-policy flag value to Apple's wire format.
// The doc table uses numeric values: 0 = No Message Stored, 1 = Most Recent
// Message Stored.
function storagePolicyToWire(flagValue) {
  return flagValue === "most-recent-message" ? 1 : 0;
}

function printApnsReason(bodyText) {
  if (!bodyText) return;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed.reason === "string") {
      const guide = APNS_REASON_GUIDE[parsed.reason];
      if (guide) {
        console.log(`APNs reason: ${parsed.reason} — ${guide.cause}`);
        console.log(`Fix: ${guide.fix}`);
      } else {
        console.log(`APNs reason: ${parsed.reason} — not in the local guide. Check Apple's APNs documentation.`);
      }
    }
  } catch {
    // Body wasn't JSON; leave the raw output alone.
  }
}

function printSkewWarning(responseHeaders) {
  const dateHeader = responseHeaders.date;
  if (!dateHeader) return;
  const serverMs = new Date(dateHeader).getTime();
  if (!Number.isFinite(serverMs)) return;
  const skewMs = Math.abs(Date.now() - serverMs);
  if (skewMs > 5 * 60 * 1000) {
    console.log(
      `⚠ Local clock skew vs APNs: ${formatSkew(skewMs)}. JWTs become invalid past ~1 hour of skew. Sync system time before debugging InvalidProviderToken.`,
    );
  }
}

function http2Request({ origin, headers, body }) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(origin);
    client.on("error", (err) => reject(err));
    const req = client.request(headers);
    req.setEncoding("utf8");
    let status = 0;
    let responseHeaders = {};
    let bodyText = "";
    req.on("response", (h) => {
      status = h[":status"];
      responseHeaders = h;
    });
    req.on("data", (chunk) => (bodyText += chunk));
    req.on("end", () => {
      client.close();
      resolve({ status, responseHeaders, bodyText });
    });
    req.on("error", (err) => reject(err));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function runDeviceSend(config) {
  ensureEnv();
  const keyPem = fs.readFileSync(path.resolve(process.env.APNS_KEY_PATH), "utf8");
  const jwt = makeJwt(keyPem, process.env.APNS_KEY_ID, process.env.APNS_TEAM_ID);
  const payload =
    config.type === "liveactivity"
      ? JSON.stringify(buildLiveActivityPayload(config, { includeAttributes: true }))
      : JSON.stringify(buildAlertPayload(config));
  const headers = buildDeviceHeaders(config, jwt, process.env.APNS_BUNDLE_ID);
  const { status, responseHeaders, bodyText } = await http2Request({
    origin: `https://${sendHost(config.env)}:443`,
    headers,
    body: payload,
  });
  console.log(`HTTP ${status}`);
  console.log(`Topic: ${headers["apns-topic"]}`);
  console.log(`Push-type: ${headers["apns-push-type"]}`);
  console.log(`Payload: ${payload}`);
  if (bodyText) console.log(`Body: ${bodyText}`);
  printApnsReason(bodyText);
  printSkewWarning(responseHeaders);
  return status >= 200 && status < 300 ? 0 : 1;
}

async function runBroadcastSend(config) {
  ensureEnv();
  const keyPem = fs.readFileSync(path.resolve(process.env.APNS_KEY_PATH), "utf8");
  const jwt = makeJwt(keyPem, process.env.APNS_KEY_ID, process.env.APNS_TEAM_ID);
  const payload = JSON.stringify(buildBroadcastPayload(config));
  const headers = buildBroadcastHeaders(config, jwt, process.env.APNS_BUNDLE_ID);
  const { status, responseHeaders, bodyText } = await http2Request({
    origin: `https://${sendHost(config.env)}:443`,
    headers,
    body: payload,
  });
  console.log(`HTTP ${status}`);
  console.log(`Path: ${headers[":path"]}`);
  console.log(`Channel-id: ${headers["apns-channel-id"]}`);
  console.log(`Push-type: ${headers["apns-push-type"]}`);
  console.log(`Payload: ${payload}`);
  if (bodyText) console.log(`Body: ${bodyText}`);
  printApnsReason(bodyText);
  printSkewWarning(responseHeaders);
  return status >= 200 && status < 300 ? 0 : 1;
}

async function runChannelManagement(config) {
  ensureEnv();
  const keyPem = fs.readFileSync(path.resolve(process.env.APNS_KEY_PATH), "utf8");
  const jwt = makeJwt(keyPem, process.env.APNS_KEY_ID, process.env.APNS_TEAM_ID);
  const bundleId = process.env.APNS_BUNDLE_ID;
  const { host, port } = manageHost(config.env);
  const origin = `https://${host}:${port}`;

  let headers;
  let body;
  if (config.action === "create") {
    headers = {
      ":method": "POST",
      ":path": `/1/apps/${bundleId}/channels`,
      authorization: `bearer ${jwt}`,
      "content-type": "application/json",
    };
    // Apple body fields: message-storage-policy (0 = No Message Stored,
    // 1 = Most Recent Message Stored), push-type (only "LiveActivity" allowed).
    body = JSON.stringify({
      "message-storage-policy": storagePolicyToWire(config.storagePolicy),
      "push-type": "LiveActivity",
    });
  } else if (config.action === "list") {
    headers = {
      ":method": "GET",
      ":path": `/1/apps/${bundleId}/all-channels`,
      authorization: `bearer ${jwt}`,
    };
  } else {
    // delete
    headers = {
      ":method": "DELETE",
      ":path": `/1/apps/${bundleId}/channels`,
      authorization: `bearer ${jwt}`,
      "apns-channel-id": config.channelId,
    };
  }

  const { status, responseHeaders, bodyText } = await http2Request({
    origin,
    headers,
    body,
  });

  // Compact print path — channel management responses use status conventions
  // that the standard send footer would obscure (201 create, 200 list, 204
  // delete; channel id arrives in a header on create, body on list).
  console.log(`HTTP ${status}`);
  console.log(`Action: channel-${config.action}`);
  console.log(`Endpoint: ${origin}${headers[":path"]}`);
  if (config.action === "create") {
    const newChannelId = responseHeaders["apns-channel-id"];
    if (newChannelId) console.log(`Created channel-id: ${newChannelId}`);
  }
  if (config.action === "delete" && status === 204) {
    console.log(`Deleted channel-id: ${config.channelId}`);
  }
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      console.log(`Body: ${JSON.stringify(parsed, null, 2)}`);
    } catch {
      console.log(`Body: ${bodyText}`);
    }
  }
  printApnsReason(bodyText);
  printSkewWarning(responseHeaders);

  // Treat the documented success codes as exit 0 even if outside the generic
  // 2xx band (they are 2xx, but be explicit).
  const expectedSuccess = config.action === "create" ? 201 : config.action === "list" ? 200 : 204;
  return status === expectedSuccess ? 0 : 1;
}

function ensureEnv() {
  for (const k of REQUIRED_ENV) {
    if (!process.env[k]) {
      throw new ConfigError(`Missing env: ${k}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  // Env check runs before arg parsing to preserve the original script's
  // ordering — older docs and runbooks tell users to expect "Missing env:
  // APNS_KEY_PATH" as the first failure on a fresh checkout, before any
  // CLI-flag confusion.
  try {
    ensureEnv();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return err.exitCode ?? 2;
    }
    throw err;
  }

  let config;
  try {
    config = parseAndValidateArgs(argv);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return err.exitCode ?? 2;
    }
    throw err;
  }

  try {
    if (config.mode === "channel-management") return await runChannelManagement(config);
    if (config.mode === "broadcast") return await runBroadcastSend(config);
    return await runDeviceSend(config);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return err.exitCode ?? 2;
    }
    throw err;
  }
}

// Only run when executed directly (`node scripts/send-apns.mjs …`). When
// imported from a test the module loads without dispatching a request — the
// tests call parseAndValidateArgs() directly.
const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectInvocation) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("Connection error:", err.message ?? err);
      process.exit(1);
    },
  );
}
