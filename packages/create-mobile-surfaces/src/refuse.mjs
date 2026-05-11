// Refuse-screen renderer. Split from mode.mjs so detection stays a pure
// data transform (cwd state -> mode result) and presentation lives next to
// the rest of the user-facing copy. Each refuse reason gets a tailored
// screen — the value here is naming the user's actual situation and the
// smallest concrete next step.

import pc from "picocolors";
import { refuse as refuseCopy } from "./copy.mjs";

export function renderRefuse(mode) {
  const { evidence } = mode;
  let body;
  switch (evidence.reason) {
    case "no-package-json":
      body = refuseCopy.noPackageJson;
      break;
    case "invalid-package-json":
      body = refuseCopy.invalidPackageJson(evidence.cwd);
      break;
    case "no-expo-dep":
      body = refuseCopy.noExpoDep(evidence.packageName);
      break;
    case "apps-mobile-exists":
      body = refuseCopy.appsMobileExists(evidence.packageName);
      break;
    default:
      throw new Error(
        `renderRefuse received an unknown evidence.reason: ${JSON.stringify(evidence.reason)}. ` +
          `This is a bug in detectMode — every refuse branch should populate one of the documented reason values.`,
      );
  }

  process.stdout.write("\n" + pc.yellow("▲  ") + pc.bold("Can't add Mobile Surfaces here.") + "\n\n");
  for (const line of body.split("\n")) {
    process.stdout.write(line ? "   " + line + "\n" : "\n");
  }
  process.stdout.write("\n");
}
