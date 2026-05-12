#!/usr/bin/env node
// Thin wrapper over @mobile-surfaces/push for one-off sends from the local
// machine. Five send modes plus channel management:
//   --type=alert                         regular notification (apns-push-type=alert)
//   --type=liveactivity --activity-token=…       ActivityKit start/update/end on an existing activity
//   --type=liveactivity --push-to-start-token=…  iOS 17.2+ remote start via push-to-start token (event=start only)
//   --type=liveactivity --channel-id=…           iOS 18 broadcast push on a channel (event=update only)
//   --channel-action=create|list|delete          iOS 18 channel management
//
// The SDK is the single source of truth for JWT minting, HTTP/2 transport,
// retry policy, and the APNs reason guide. This script's job is parse + dispatch
// + print. If you find yourself reading APNs internals to debug this file,
// look in packages/push/src/ first.
//
// Env (load from .env.local or shell):
//   APNS_KEY_PATH        path to the .p8 APNs auth key
//   APNS_KEY_ID          10-char key id from Apple Dev portal
//   APNS_TEAM_ID         10-char team id
//   APNS_BUNDLE_ID       e.g. com.example.mobilesurfaces (no .push-type.liveactivity suffix)
//
// Usage examples (every send requires --snapshot-file — for credential-only
// validation, use `pnpm surface:setup-apns` instead):
//   node scripts/send-apns.mjs --device-token=<hex> --type=alert \
//     --snapshot-file=./data/surface-fixtures/active-progress.json --env=development
//   node scripts/send-apns.mjs --activity-token=<hex> --type=liveactivity \
//     --event=update --snapshot-file=./data/surface-fixtures/active-progress.json --env=development
//   node scripts/send-apns.mjs --push-to-start-token=<hex> --type=liveactivity \
//     --event=start --snapshot-file=./data/surface-fixtures/queued.json \
//     --attributes-file=./data/example-attributes.json --env=development
//
// Verification mode (--print / --describe): emits the request envelope the SDK
// *would* dispatch (push type, topic, priority, payload bytes vs MS011 ceiling,
// effective retry policy, trap hits) without making the network call. Useful
// for AI-generated invocations and CI assertions that don't have APNs creds.
//   node scripts/send-apns.mjs --device-token=<hex> --type=alert \
//     --snapshot-file=./data/surface-fixtures/queued.json --print
//
// Machine-readable mode (--json): stdout becomes a stable JSON object with
// deterministic keys and structured error context. Stderr stays human-readable.
//   node scripts/send-apns.mjs --device-token=<hex> --type=alert \
//     --snapshot-file=./data/surface-fixtures/queued.json --json
//
// `--stale-date=<unix-seconds>` and `--dismissal-date=<unix-seconds>` map
// directly to the APNs `stale-date` and `dismissal-date` aps fields.
//
// `--priority` overrides apns-priority. Defaults: 5 for liveactivity (MS015 —
// Apple rate-limits priority 10 aggressively), 10 for alert.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadEnvFile } from "./lib/load-env.mjs";
import { assertSnapshot } from "../packages/surface-contracts/src/index.ts";
import {
  APNS_REASON_GUIDE,
  ApnsError,
  createPushClient,
} from "../packages/push/src/index.ts";

// Pick up APNs creds written by `pnpm surface:setup-apns`. Existing shell
// exports still win — loadEnvFile only fills unset keys. Silent no-op when
// no .env exists.
loadEnvFile(".env");

// Re-exported so scripts/send-apns.test.mjs can assert the catalog stays in
// sync. The SDK is the only source.
export { APNS_REASON_GUIDE };

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
  "attributes-file": { type: "string" },
  "attributes-type": {
    type: "string",
    default: "MobileSurfacesActivityAttributes",
  },
  "stale-date": { type: "string" },
  "dismissal-date": { type: "string" },
  priority: { type: "string" },
  print: { type: "boolean", default: false },
  describe: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
};

// Hex-only validation for tokens that travel in URL paths. APNs tokens are
// 64-hex-char lowercase strings, but Apple has occasionally widened the
// length; we accept any non-empty hex run rather than false-rejecting.
const HEX_TOKEN_PATTERN = /^[0-9a-fA-F]+$/;

const SETUP_REDIRECT =
  "If you're trying to validate credentials, run `pnpm surface:setup-apns` " +
  "— it probes APNs sandbox with a fake token and reports auth issues without " +
  "needing a real device token or a snapshot fixture.";

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

function parsePriority(raw) {
  if (raw === undefined) return undefined;
  if (raw !== "5" && raw !== "10") {
    throw new ConfigError(`--priority must be 5 or 10 (got ${JSON.stringify(raw)})`);
  }
  return Number(raw);
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

  // --print / --describe / --json are flags that compose orthogonally with
  // every mode. Resolve them once up front.
  const meta = {
    print: Boolean(values.print || values.describe),
    json: Boolean(values.json),
  };

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
    return { ...validateChannelManagement(values, modeFlags), ...meta };
  }

  if (values["channel-id"] !== undefined) {
    return { ...validateBroadcast(values, modeFlags), ...meta };
  }

  if (values["push-to-start-token"] !== undefined) {
    return { ...validatePushToStart(values, modeFlags), ...meta };
  }

  return { ...validateDeviceSend(values), ...meta };
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

  if (!values["snapshot-file"]) {
    throw new ConfigError(
      `--channel-id (broadcast) requires --snapshot-file. ${SETUP_REDIRECT}`,
    );
  }

  return {
    mode: "broadcast",
    env: values.env,
    channelId: values["channel-id"],
    snapshotFile: values["snapshot-file"],
    staleDate: parseUnixSeconds(values["stale-date"], "--stale-date"),
    priority: parsePriority(values.priority),
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

  if (!values["snapshot-file"]) {
    throw new ConfigError(
      `--event=start requires --snapshot-file. ${SETUP_REDIRECT}`,
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
    attributesFile: values["attributes-file"],
    attributesType: values["attributes-type"],
    staleDate: parseUnixSeconds(values["stale-date"], "--stale-date"),
    dismissalDate: parseUnixSeconds(values["dismissal-date"], "--dismissal-date"),
    priority: parsePriority(values.priority),
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

  if (!values["snapshot-file"]) {
    throw new ConfigError(
      `--type=${values.type} requires --snapshot-file. ${SETUP_REDIRECT}`,
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
    attributesFile: values["attributes-file"],
    attributesType: values["attributes-type"],
    staleDate: parseUnixSeconds(values["stale-date"], "--stale-date"),
    dismissalDate: parseUnixSeconds(values["dismissal-date"], "--dismissal-date"),
    priority: parsePriority(values.priority),
  };
}

function readSnapshotFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const { $schema: _schema, ...snapshot } = raw;
  return assertSnapshot(snapshot);
}

function readAttributesFile(filePath) {
  const attrSource = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (typeof attrSource.surfaceId !== "string" || typeof attrSource.modeLabel !== "string") {
    throw new ConfigError(
      `--attributes-file ${filePath} must include string fields surfaceId and modeLabel`,
    );
  }
  return {
    surfaceId: attrSource.surfaceId,
    modeLabel: attrSource.modeLabel,
  };
}

function makeClient(env) {
  return createPushClient({
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
    keyPath: process.env.APNS_KEY_PATH,
    bundleId: process.env.APNS_BUNDLE_ID,
    environment: env,
  });
}

// Map a CLI mode to the SDK describe-operation name.
function describeOperationFor(config) {
  if (config.mode === "broadcast") return "broadcast";
  if (config.mode === "device-send") {
    if (config.type === "alert") return "alert";
    return config.event; // start | update | end
  }
  throw new Error(`describeSend not applicable to mode=${config.mode}`);
}

// Emit a JSON object on stdout (deterministic key order) when --json is set;
// otherwise format human-readable output. Errors always include `ok: false`
// and a structured `error` block when --json is set.
function emit(payload, { json, exitCode = 0 } = {}) {
  if (json) {
    process.stdout.write(JSON.stringify(payload) + "\n");
    return exitCode;
  }
  if (payload.ok && payload.kind === "send") {
    console.log(`HTTP ${payload.status}`);
    if (payload.topic) console.log(`Topic: ${payload.topic}`);
    if (payload.pushType) console.log(`Push-type: ${payload.pushType}`);
    if (payload.priority !== undefined) console.log(`Priority: ${payload.priority}`);
    if (payload.apnsId) console.log(`apns-id: ${payload.apnsId}`);
    console.log(`Attempts: ${payload.attempts} (latency ${payload.latencyMs}ms)`);
    if (payload.trapHits?.length) console.log(`Trap hits: ${payload.trapHits.join(", ")}`);
    if (payload.retried?.length) {
      console.log(`Retries:`);
      for (const r of payload.retried) {
        const tag = r.trapId ? ` [${r.trapId}]` : "";
        console.log(`  attempt ${r.attempt}: ${r.reason}${tag} (backoff ${r.backoffMs}ms)`);
      }
    }
  } else if (payload.ok && payload.kind === "describe") {
    console.log(`Plan (--print): NOT dispatching to APNs`);
    console.log(`Operation: ${payload.operation}`);
    if (payload.topic) console.log(`Topic: ${payload.topic}`);
    console.log(`Push-type: ${payload.pushType}`);
    console.log(`Priority: ${payload.priority}`);
    console.log(`Payload bytes: ${payload.payloadBytes} / ${payload.budgetLimit} (MS011)`);
    console.log(`Within budget: ${payload.withinBudget}`);
    if (payload.trapHits.length) console.log(`Trap hits: ${payload.trapHits.join(", ")}`);
  } else if (payload.ok && payload.kind === "channel-create") {
    console.log(`HTTP 201`);
    console.log(`Created channel-id: ${payload.channelId}`);
    console.log(`Storage policy: ${payload.storagePolicy}`);
  } else if (payload.ok && payload.kind === "channel-list") {
    console.log(`HTTP 200`);
    console.log(`Channels: ${payload.channels.length}`);
    for (const ch of payload.channels) {
      console.log(`  ${ch.channelId} (${ch.storagePolicy ?? "unknown-policy"})`);
    }
  } else if (payload.ok && payload.kind === "channel-delete") {
    console.log(`HTTP 204`);
    console.log(`Deleted channel-id: ${payload.channelId}`);
  } else {
    const err = payload.error ?? {};
    console.error(`Error: ${err.message ?? "unknown error"}`);
    if (err.reason) console.error(`APNs reason: ${err.reason}`);
    if (err.trapId) console.error(`Trap: ${err.trapId}`);
    if (err.docsUrl) console.error(`Docs: ${err.docsUrl}`);
    if (err.fix) console.error(`Fix: ${err.fix}`);
  }
  return exitCode;
}

function errorPayload(err) {
  if (err instanceof ApnsError) {
    const guide = APNS_REASON_GUIDE[err.reason];
    return {
      ok: false,
      error: {
        message: err.message,
        reason: err.reason,
        status: err.status,
        apnsId: err.apnsId,
        trapId: err.trapId,
        docsUrl: err.docsUrl,
        fix: guide?.fix,
      },
    };
  }
  if (err && err.name === "InvalidSnapshotError") {
    return {
      ok: false,
      error: {
        message: err.message,
        issues: err.issues ?? [],
      },
    };
  }
  return {
    ok: false,
    error: { message: err?.message ?? String(err) },
  };
}

async function runDeviceSend(config) {
  const client = makeClient(config.env);
  try {
    const snapshot = readSnapshotFile(config.snapshotFile);
    const options = {};
    if (config.staleDate !== undefined) options.staleDateSeconds = config.staleDate;
    if (config.dismissalDate !== undefined) options.dismissalDateSeconds = config.dismissalDate;
    if (config.priority !== undefined) options.priority = config.priority;

    if (config.print) {
      const op = describeOperationFor(config);
      const planOptions = { ...options };
      if (config.type === "liveactivity" && config.event === "start") {
        planOptions.attributesType = config.attributesType;
      }
      const plan = client.describeSend(op, snapshot, planOptions);
      return emit({ ok: true, kind: "describe", ...plan }, { json: config.json });
    }

    if (config.type === "alert") {
      const res = await client.alert(config.token, snapshot, options);
      return emit(formatSendPayload({ res, pushType: "alert", topic: bundleTopic("alert"), priority: options.priority ?? 10 }), { json: config.json });
    }
    if (config.event === "start") {
      const attributes = readAttributesFile(config.attributesFile);
      const res = await client.start(config.token, snapshot, attributes, {
        ...options,
        attributesType: config.attributesType,
      });
      return emit(formatSendPayload({ res, pushType: "liveactivity", topic: bundleTopic("liveactivity"), priority: options.priority ?? 5 }), { json: config.json });
    }
    if (config.event === "end") {
      const res = await client.end(config.token, snapshot, options);
      return emit(formatSendPayload({ res, pushType: "liveactivity", topic: bundleTopic("liveactivity"), priority: options.priority ?? 5 }), { json: config.json });
    }
    const res = await client.update(config.token, snapshot, options);
    return emit(formatSendPayload({ res, pushType: "liveactivity", topic: bundleTopic("liveactivity"), priority: options.priority ?? 5 }), { json: config.json });
  } finally {
    await client.close();
  }
}

async function runBroadcastSend(config) {
  const client = makeClient(config.env);
  try {
    const snapshot = readSnapshotFile(config.snapshotFile);
    const options = {};
    if (config.staleDate !== undefined) options.staleDateSeconds = config.staleDate;
    if (config.priority !== undefined) options.priority = config.priority;

    if (config.print) {
      const plan = client.describeSend("broadcast", snapshot, options);
      return emit({ ok: true, kind: "describe", ...plan }, { json: config.json });
    }

    const res = await client.broadcast(config.channelId, snapshot, options);
    return emit(formatSendPayload({ res, pushType: "liveactivity", topic: undefined, priority: options.priority ?? 5 }), { json: config.json });
  } finally {
    await client.close();
  }
}

async function runChannelManagement(config) {
  if (config.print) {
    // Management ops have no payload-shape question to answer; --print on
    // them is a no-op describing the action the client would take.
    return emit({
      ok: true,
      kind: "describe",
      operation: `channel-${config.action}`,
      env: config.env,
      channelId: config.channelId ?? null,
      storagePolicy: config.action === "create" ? config.storagePolicy : null,
    }, { json: config.json });
  }

  const client = makeClient(config.env);
  try {
    if (config.action === "create") {
      const info = await client.createChannel({ storagePolicy: config.storagePolicy });
      return emit({
        ok: true,
        kind: "channel-create",
        channelId: info.channelId,
        storagePolicy: info.storagePolicy,
      }, { json: config.json });
    }
    if (config.action === "list") {
      const channels = await client.listChannels();
      return emit({ ok: true, kind: "channel-list", channels }, { json: config.json });
    }
    await client.deleteChannel(config.channelId);
    return emit({ ok: true, kind: "channel-delete", channelId: config.channelId }, { json: config.json });
  } finally {
    await client.close();
  }
}

function formatSendPayload({ res, pushType, topic, priority }) {
  return {
    ok: true,
    kind: "send",
    apnsId: res.apnsId,
    status: res.status,
    pushType,
    topic,
    priority,
    attempts: res.attempts,
    latencyMs: res.latencyMs,
    retried: res.retried,
    trapHits: res.trapHits,
  };
}

function bundleTopic(pushType) {
  const bundleId = process.env.APNS_BUNDLE_ID;
  return pushType === "liveactivity"
    ? `${bundleId}.push-type.liveactivity`
    : bundleId;
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
  // ordering — older runbooks expect "Missing env: APNS_KEY_PATH" as the
  // first failure on a fresh checkout. --print can skip the env check
  // because describeSend has no APNs round-trip; but createPushClient still
  // wants the auth options populated, so we keep the check unconditional.
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
    emit(errorPayload(err), { json: config.json, exitCode: 1 });
    return 1;
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
