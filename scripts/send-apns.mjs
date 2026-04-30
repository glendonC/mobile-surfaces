#!/usr/bin/env node
// Send a push to APNs from the local machine. Two modes:
//   --type=alert         regular notification (apns-push-type=alert)
//   --type=liveactivity  ActivityKit update or end (apns-push-type=liveactivity)
//
// Env (load from .env.local or shell):
//   APNS_KEY_PATH        path to the .p8 APNs auth key
//   APNS_KEY_ID          10-char key id from Apple Dev portal
//   APNS_TEAM_ID         10-char team id
//   APNS_BUNDLE_ID       e.g. com.example.mobilesurfaces
//
// Usage:
//   node scripts/send-apns.mjs --device-token=<hex> --type=alert --env=development
//   node scripts/send-apns.mjs --activity-token=<hex> --type=liveactivity \
//     --event=update --snapshot-file=./data/surface-fixtures/active-progress.json --env=development
//
// `device-token` is the APNs device token (regular pushes).
// `activity-token` is the Live Activity push token. Source depends on --event:
//   - update / end: token from `Activity.pushTokenUpdates` for an existing activity.
//   - start (iOS 17.2+): push-to-start token from `Activity<…>.pushToStartTokenUpdates`.
//
// Live Activity events:
//   --event=start    iOS 17.2+ remote start. Requires --attributes-file with
//                    surfaceId and modeLabel; defaults --attributes-type to
//                    MobileSurfacesActivityAttributes (override after rename).
//   --event=update   ActivityKit content update.
//   --event=end      End the activity. Sets dismissal-date to now unless
//                    --dismissal-date is passed.
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
import { parseArgs } from "node:util";

// Apple's APNs returns a JSON body with a `reason` enum on every non-2xx.
// docs/troubleshooting.md (#31-44) maps these to causes; mirror the table here
// so the script can print a fix below the raw Body line without making the
// user switch tabs. Keep the raw Body intact for transcript fidelity.
const APNS_REASON_GUIDE = {
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
    fix: "Pass a positive unix-seconds integer. The script validates --stale-date and --dismissal-date locally, so this usually means clock skew or a stale state file.",
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
    cause: "ActivityKit payload exceeded 4 KB.",
    fix: "Trim --state-file or --snapshot-file. ActivityKit content-state plus attributes is bounded at 4 KB.",
  },
  ExpiredProviderToken: {
    cause: "JWT is older than 1 hour and APNs rejected it.",
    fix: "JWTs are minted per script run with iat=now; this usually means system clock skew. Sync NTP and retry.",
  },
  TooManyRequests: {
    cause: "Apple is rate-limiting your bundle id (or the Live Activity priority budget is exhausted).",
    fix: "Back off. Live Activity priority 10 has aggressive budgets — drop to 5 unless the update is user-visible.",
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
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`Missing env: ${k}`);
    process.exit(2);
  }
}

const { values } = parseArgs({
  options: {
    "device-token": { type: "string" },
    "activity-token": { type: "string" },
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
  },
  strict: true,
});

const isLiveActivity = values.type === "liveactivity";
const token = isLiveActivity ? values["activity-token"] : values["device-token"];
if (!token) {
  console.error(`Missing --${isLiveActivity ? "activity-token" : "device-token"}`);
  process.exit(2);
}

if (isLiveActivity && !["start", "update", "end"].includes(values.event)) {
  console.error(`--event must be one of: start, update, end (got ${JSON.stringify(values.event)})`);
  process.exit(2);
}

if (isLiveActivity && values.event === "start" && !values["attributes-file"]) {
  console.error("--event=start requires --attributes-file with surfaceId and modeLabel");
  process.exit(2);
}

const staleDate = parseUnixSeconds(values["stale-date"], "--stale-date");
const dismissalDate = parseUnixSeconds(values["dismissal-date"], "--dismissal-date");

const host =
  values.env === "production"
    ? "api.push.apple.com"
    : "api.development.push.apple.com";

const keyPem = fs.readFileSync(path.resolve(process.env.APNS_KEY_PATH), "utf8");

function base64Url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeJwt() {
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }),
  );
  const signingInput = `${header}.${payload}`;
  const sig = crypto
    .createSign("SHA256")
    .update(signingInput)
    .sign({ key: keyPem, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64Url(sig)}`;
}

function buildPayload() {
  if (!isLiveActivity) {
    const snapshot = values["snapshot-file"]
      ? JSON.parse(fs.readFileSync(values["snapshot-file"], "utf8"))
      : null;
    return {
      aps: {
        alert: {
          title: snapshot?.primaryText ?? values.title,
          body: snapshot?.secondaryText ?? values.body,
        },
        sound: "default",
      },
      liveSurface: snapshot
        ? {
            kind: "surface_snapshot",
            snapshotId: snapshot.id,
            surfaceId: snapshot.surfaceId,
            state: snapshot.state,
            deepLink: snapshot.deepLink,
          }
        : { kind: "smoke_test" },
    };
  }

  let contentState = JSON.parse(
    fs.readFileSync(path.resolve("./scripts/sample-state.json"), "utf8"),
  );
  if (values["snapshot-file"]) {
    const snapshot = JSON.parse(fs.readFileSync(values["snapshot-file"], "utf8"));
    contentState = {
      headline: snapshot.primaryText,
      subhead: snapshot.secondaryText,
      progress: snapshot.progress,
      stage: snapshot.stage,
    };
  }
  if (values["state-file"]) {
    contentState = JSON.parse(fs.readFileSync(values["state-file"], "utf8"));
  }

  const aps = {
    timestamp: Math.floor(Date.now() / 1000),
    event: values.event,
    "content-state": contentState,
  };

  if (values.event === "start") {
    const attrSource = JSON.parse(fs.readFileSync(values["attributes-file"], "utf8"));
    if (typeof attrSource.surfaceId !== "string" || typeof attrSource.modeLabel !== "string") {
      console.error(`--attributes-file ${values["attributes-file"]} must include string fields surfaceId and modeLabel`);
      process.exit(2);
    }
    aps["attributes-type"] = values["attributes-type"];
    aps.attributes = {
      surfaceId: attrSource.surfaceId,
      modeLabel: attrSource.modeLabel,
    };
  }

  if (staleDate !== undefined) aps["stale-date"] = staleDate;

  if (values.event === "end") {
    aps["dismissal-date"] = dismissalDate ?? Math.floor(Date.now() / 1000);
  } else if (dismissalDate !== undefined) {
    aps["dismissal-date"] = dismissalDate;
  }

  return { aps };
}

function parseUnixSeconds(raw, label) {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    console.error(`${label} must be a positive integer unix timestamp in seconds (got ${JSON.stringify(raw)})`);
    process.exit(2);
  }
  return n;
}

function buildHeaders(jwt) {
  const apnsTopic = isLiveActivity
    ? `${process.env.APNS_BUNDLE_ID}.push-type.liveactivity`
    : process.env.APNS_BUNDLE_ID;
  // Apple budgets Live Activity updates by priority. Default to 5
  // (non-time-sensitive) and only escalate to 10 when the user must see the
  // change immediately. Alerts default to 10 since they are user-initiated.
  // Override with --priority=<5|10>.
  const priority = values.priority ?? (isLiveActivity ? "5" : "10");
  const headers = {
    ":method": "POST",
    ":path": `/3/device/${token}`,
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

const jwt = makeJwt();
const payload = JSON.stringify(buildPayload());
const headers = buildHeaders(jwt);

const client = http2.connect(`https://${host}:443`);
client.on("error", (err) => {
  console.error("Connection error:", err.message);
  process.exit(1);
});

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
  console.log(`HTTP ${status}`);
  console.log(`Topic: ${headers["apns-topic"]}`);
  console.log(`Push-type: ${headers["apns-push-type"]}`);
  console.log(`Payload: ${payload}`);
  if (bodyText) console.log(`Body: ${bodyText}`);

  // Translate the APNs reason if the body parses as JSON. JWTs become invalid
  // past ~1 hour of clock skew; warn well before we hit InvalidProviderToken.
  if (bodyText) {
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

  // HTTP/2 lowercases header names. APNs always returns Date: per RFC 7231;
  // a missing header means we have nothing to compare against and the warning
  // is correctly skipped.
  const dateHeader = responseHeaders.date;
  if (dateHeader) {
    const serverMs = new Date(dateHeader).getTime();
    if (Number.isFinite(serverMs)) {
      const skewMs = Math.abs(Date.now() - serverMs);
      if (skewMs > 5 * 60 * 1000) {
        console.log(
          `⚠ Local clock skew vs APNs: ${formatSkew(skewMs)}. JWTs become invalid past ~1 hour of skew. Sync system time before debugging InvalidProviderToken.`,
        );
      }
    }
  }

  process.exit(status >= 200 && status < 300 ? 0 : 1);
});

req.write(payload);
req.end();
