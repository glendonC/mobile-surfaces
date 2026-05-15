// Live setup probes for the Mobile Surfaces harness. Returns
// DiagnosticCheck-shaped results so the same shape that drives surface:check
// (CI) drives the in-harness status panel (runtime). Each result carries a
// trapId where applicable so SetupStatusPanel can deep-link into the
// catalog for the fix text.
//
// Probes here are intentionally cheap and idempotent: tap-to-refresh is
// fine; running them on every adapter event is fine. No probe writes
// permanent state to the App Group — the writability probe uses a fixed
// debug key and removes it after readback.

import { Platform } from "react-native";
import Constants from "expo-constants";
import { ExtensionStorage } from "@bacons/apple-targets";
import type { DiagnosticCheck } from "@mobile-surfaces/surface-contracts";
import { liveActivityAdapter } from "../liveActivity";
import { APP_GROUP } from "../generated/appGroup";
import { readSurfaceDecodeError } from "../surfaceStorage";
import {
  controlSurfaceFixtures,
  lockAccessorySurfaceFixtures,
  standbySurfaceFixtures,
  widgetSurfaceFixtures,
} from "../fixtures/surfaceFixtures";

const PROBE_KEY = "diagnostic.appGroupProbe";

// Decode-error breadcrumbs older than this are ignored — a stale breadcrumb
// from a previous test run shouldn't keep flagging the diagnostics panel.
// 24h matches the harness's typical "single working session" window.
const DECODE_ERROR_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export interface SetupProbeInput {
  /** Latest push-to-start token observed this session, if any. */
  pushToStartToken: string | null;
  /** Currently active activity id (drives the "live" indicator), if any. */
  activeActivityId: string | null;
}

/**
 * Run every harness setup probe and return DiagnosticCheck rows in display
 * order. Resolves rather than rejects on probe failure: a probe that throws
 * surfaces as a `fail`-status row, never as an unhandled rejection.
 */
export async function runSetupProbes(
  input: SetupProbeInput,
): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  checks.push(probeIosVersion());
  checks.push(probeRuntimeContext());
  checks.push(await probeLiveActivities());
  checks.push(probeAppGroupWritability());
  checks.push(probePushToStartToken(input.pushToStartToken));
  checks.push(probeActiveActivity(input.activeActivityId));
  checks.push(probeSurfaceDecodeErrors());
  return checks;
}

// Surface IDs the widget extension may render. Mirrors the keys exposed by the
// harness fixtures; new fixtures added under data/surface-fixtures/ flow in
// automatically via fixtures/surfaceFixtures.ts. We probe every known id so a
// silent decode failure on one surface surfaces here even if the harness UI
// hasn't been pointed at that surface yet this session.
function knownWidgetSurfaceIds(): readonly string[] {
  const ids = new Set<string>();
  for (const fixture of Object.values(widgetSurfaceFixtures)) ids.add(fixture.surfaceId);
  for (const fixture of Object.values(controlSurfaceFixtures)) ids.add(fixture.surfaceId);
  for (const fixture of Object.values(lockAccessorySurfaceFixtures)) ids.add(fixture.surfaceId);
  for (const fixture of Object.values(standbySurfaceFixtures)) ids.add(fixture.surfaceId);
  return Array.from(ids);
}

// --- iOS version ---------------------------------------------------------

function probeIosVersion(): DiagnosticCheck {
  if (Platform.OS !== "ios") {
    return {
      id: "ios-version",
      status: "warn",
      summary: `Host platform is ${Platform.OS}; the harness expects iOS.`,
    };
  }
  const version = String(Platform.Version);
  const [majorStr, minorStr = "0"] = version.split(".");
  const major = Number(majorStr);
  const minor = Number(minorStr);
  const meetsFloor =
    Number.isFinite(major) && (major > 17 || (major === 17 && minor >= 2));
  return {
    id: "ios-version",
    status: meetsFloor ? "ok" : "fail",
    trapId: "MS012",
    summary: meetsFloor
      ? `iOS ${version} meets the 17.2 floor.`
      : `iOS ${version} is below the 17.2 floor.`,
    ...(meetsFloor
      ? {}
      : {
          detail: {
            message:
              "Push-to-start tokens require iOS 17.2+. Update the device or simulator.",
          },
        }),
  };
}

// --- Runtime context (Expo Go vs dev build) -----------------------------

function probeRuntimeContext(): DiagnosticCheck {
  const ownership = Constants.appOwnership;
  if (ownership === "expo") {
    return {
      id: "runtime-context",
      status: "fail",
      summary: "Running in Expo Go.",
      detail: {
        message:
          "Live Activities, widgets, and controls require a development build. Run pnpm mobile:sim or pnpm mobile:run:ios:device.",
      },
    };
  }
  return {
    id: "runtime-context",
    status: "ok",
    summary: "Running in a development build.",
  };
}

// --- Live Activities authorization --------------------------------------

async function probeLiveActivities(): Promise<DiagnosticCheck> {
  try {
    const enabled = await liveActivityAdapter.areActivitiesEnabled();
    return {
      id: "live-activities-enabled",
      status: enabled ? "ok" : "fail",
      summary: enabled
        ? "Live Activities are enabled for this app."
        : "Live Activities report unsupported.",
      ...(enabled
        ? {}
        : {
            detail: {
              message:
                "Open iOS Settings → Face ID & Passcode and Notifications, and verify Live Activities are enabled both globally and for this app.",
            },
          }),
    };
  } catch (error) {
    return {
      id: "live-activities-enabled",
      status: "fail",
      summary: "Could not query Live Activities authorization.",
      detail: { message: extractMessage(error) },
    };
  }
}

// --- App Group writability ----------------------------------------------

function probeAppGroupWritability(): DiagnosticCheck {
  try {
    const storage = new ExtensionStorage(APP_GROUP);
    const sentinel = `probe-${Date.now()}`;
    storage.set(PROBE_KEY, sentinel);
    const readback = storage.get(PROBE_KEY);
    storage.remove(PROBE_KEY);
    if (readback !== sentinel) {
      return {
        id: "app-group-writable",
        status: "fail",
        trapId: "MS013",
        summary:
          "App Group readback did not match the value we just wrote — the entitlement is likely missing or the identifier mismatched.",
        detail: {
          message: `Verify "${APP_GROUP}" is declared on both the host app and the widget extension entitlements.`,
        },
      };
    }
    return {
      id: "app-group-writable",
      status: "ok",
      summary: `App Group "${APP_GROUP}" is writable and readable.`,
    };
  } catch (error) {
    return {
      id: "app-group-writable",
      status: "fail",
      trapId: "MS013",
      summary: "App Group probe threw on write.",
      detail: { message: extractMessage(error) },
    };
  }
}

// --- Push-to-start token observed ---------------------------------------

function probePushToStartToken(token: string | null): DiagnosticCheck {
  if (token) {
    return {
      id: "push-to-start-token",
      status: "ok",
      summary: "Push-to-start token received this session.",
    };
  }
  // Status stays "warn" so backend integrators wiring real remote-start
  // notice the row, but the copy leads with the demo-mode reassurance —
  // most users hit this row first and don't yet have an APNs backend.
  return {
    id: "push-to-start-token",
    status: "warn",
    trapId: "MS016",
    summary: "Push-to-start token: not received (optional for local testing).",
    detail: {
      message:
        "Only matters if a backend will start Live Activities remotely. Activities you start from inside this app work either way — try the Start buttons below. If you do want remote-start, force-quit the app and reopen, or wait for the system to rotate.",
    },
  };
}

// --- Active activity ----------------------------------------------------

function probeActiveActivity(activityId: string | null): DiagnosticCheck {
  if (activityId) {
    return {
      id: "active-activity",
      status: "ok",
      summary: `Active activity: ${activityId.slice(0, 8)}…`,
    };
  }
  return {
    id: "active-activity",
    status: "skip",
    summary: "No Live Activity is active. Tap a Start button to begin.",
  };
}

// --- Surface snapshot decode-error breadcrumbs --------------------------
//
// Wave 2b's Swift side (apps/mobile/targets/widget/_shared/MobileSurfacesSharedState.swift)
// writes a breadcrumb to App Group key `surface.snapshot.<surfaceId>.decodeError`
// whenever JSONDecoder rejects the snapshot payload. Shape:
//   { at: <ISO8601>, error: <string> }
// MS036 names this exact silent-failure mode: the host writes a snapshot into
// the App Group, JSONDecoder in the widget extension silently fails on a
// renamed key / type mismatch / optionality drift, and the surface renders
// placeholder data forever with no log, no crash, no error.
//
// This probe is the runtime catch: if any known surface has a breadcrumb
// younger than DECODE_ERROR_FRESHNESS_MS, surface a warn-level diagnostic
// row with the surfaceId, error message, and timestamp so the user notices
// before they're three days into wondering why the widget never updates.
function probeSurfaceDecodeErrors(): DiagnosticCheck {
  const now = Date.now();
  const fresh: Array<{ surfaceId: string; at: string; error: string }> = [];
  for (const surfaceId of knownWidgetSurfaceIds()) {
    const breadcrumb = readSurfaceDecodeError(surfaceId);
    if (!breadcrumb) continue;
    const at = Date.parse(breadcrumb.at);
    // Tolerate malformed timestamps: an unparseable `at` means we can't say
    // whether the breadcrumb is fresh, so we surface it anyway — better to
    // overreport than miss a genuine MS036 hit.
    if (Number.isFinite(at) && now - at > DECODE_ERROR_FRESHNESS_MS) continue;
    fresh.push(breadcrumb);
  }
  if (fresh.length === 0) {
    return {
      id: "surface-decode-errors",
      status: "ok",
      summary: "No widget-decode breadcrumbs in the last 24 hours.",
    };
  }
  // Single combined warn row rather than one row per surface so the panel
  // doesn't drown the user in noise when a base-shape change breaks every
  // surface at once (the MS036 fixture for catalog-induced drift).
  const summary = fresh.length === 1
    ? `Widget extension failed to decode snapshot for "${fresh[0].surfaceId}".`
    : `Widget extension failed to decode snapshots for ${fresh.length} surfaces.`;
  const lines = fresh.map(
    (b) => `  • ${b.surfaceId} @ ${b.at} — ${b.error}`,
  );
  return {
    id: "surface-decode-errors",
    status: "warn",
    trapId: "MS036",
    summary,
    detail: {
      message:
        "JSONDecoder in the widget extension rejected the payload. " +
        "Compare the Swift struct's fields and JSON keys against the " +
        "Zod projection-output schema, then run pnpm surface:check.\n" +
        lines.join("\n"),
    },
  };
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
