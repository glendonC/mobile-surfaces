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

const APP_GROUP = "group.com.example.mobilesurfaces";
const PROBE_KEY = "diagnostic.appGroupProbe";

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
  return checks;
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
  return {
    id: "push-to-start-token",
    status: "warn",
    trapId: "MS016",
    summary: "No push-to-start token received yet.",
    detail: {
      message:
        "iOS only delivers push-to-start tokens via an async sequence. The harness subscribes at mount; if no token arrives, force-quit the app and reopen, or wait for the system to rotate.",
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

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
