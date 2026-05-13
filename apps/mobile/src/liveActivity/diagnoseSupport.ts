// Diagnoses *why* iOS reports `areActivitiesEnabled === false` so the harness
// can surface a specific next step instead of a single generic hint.
//
// Live Activities can be unsupported for four reasons (also documented in
// https://mobile-surfaces.com/docs/troubleshooting):
//
//   1. iOS deployment target dropped below 17.2 (the project floor).
//   2. Running in Expo Go (Live Activities require a development build).
//   3. The user disabled Live Activities for this app in iOS Settings.
//   4. The user disabled Live Activities globally.
//
// Cases 1 and 2 are detectable from native module accessors (Platform.Version
// and Constants.appOwnership). Cases 3 and 4 are not distinguishable from JS;
// iOS just reports `false`. So this helper handles 1 and 2 explicitly and
// falls through to the existing settings hint for 3/4.
//
// There are no apps/mobile JS unit tests in this repo. The branching is
// short and read-tested; if you add a runner later, a unit test should mock
// Platform / Constants / Application and exercise each branch.

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Application from "expo-application";

const MIN_IOS_MAJOR = 17;
const MIN_IOS_MINOR = 2;

export function diagnoseSupport(): string {
  // Case 1: iOS too old. Platform.Version on iOS is a string like "17.5".
  // On non-iOS this branch shouldn't run at all (the harness is iOS-only)
  // but guard anyway so the helper is safe to import elsewhere.
  if (Platform.OS === "ios") {
    const version = String(Platform.Version);
    const [majorStr, minorStr = "0"] = version.split(".");
    const major = Number(majorStr);
    const minor = Number(minorStr);
    if (
      Number.isFinite(major) &&
      (major < MIN_IOS_MAJOR || (major === MIN_IOS_MAJOR && minor < MIN_IOS_MINOR))
    ) {
      return `iOS ${version} is below the project floor. Update to iOS ${MIN_IOS_MAJOR}.${MIN_IOS_MINOR} or newer.`;
    }
  }

  // Case 2: Expo Go. appOwnership is "expo" inside the Expo Go client,
  // "standalone" in a dev/release build, and undefined in some web/test
  // environments. Only the "expo" value is actionable.
  if (Constants.appOwnership === "expo") {
    return "Running in Expo Go. Live Activities require a development build: pnpm mobile:sim or pnpm mobile:run:ios:device.";
  }

  // Cases 3 + 4: We're in a dev build on a supported iOS but iOS still said
  // false. Fall through to the existing settings pointer with the app name
  // resolved at call time so a user who renamed the project sees their app
  // name in the hint.
  const appName = Application.applicationName ?? "this app";
  return `no (toggle in iOS Settings → Face ID & Passcode → Allow Notifications, or Settings → ${appName} → Live Activities)`;
}
