// The greenfield prompt flow. Returns a config object the rest of the CLI
// uses to materialize the project. UI primitives come from ./ui.mjs which
// wraps @inquirer/prompts and ora — no clack, no redraw bookkeeping.
//
// The `ui` parameter is a DI seam for unit tests: production callers omit
// it and pick up the live ui module; tests inject a fake object whose
// askText/askConfirm/askSelect return scripted answers and whose log/rail/
// section are no-ops. Adding the seam landed coverage for the validator-
// retry, recap-retry, and cancellation paths that mocking @inquirer/prompts
// directly does not reach.

import pc from "picocolors";
import { prompts as copy } from "./copy.mjs";
import * as defaultUi from "./ui.mjs";
import {
  toBundleId,
  toScheme,
  validateBundleId,
  validateProjectSlug,
  validateScheme,
  validateTeamId,
} from "./validators.mjs";

export async function runPrompts({ initialName, overrides = {}, yes = false, ui = defaultUi }) {
  ui.rail.step(2, 5, "Project basics");

  const projectName = overrides.projectName !== undefined
    ? overrides.projectName
    : await ui.askText({
        message: copy.projectName.message,
        defaultValue: initialName ?? "lockscreen-demo",
        validate: validateProjectSlug,
      });

  const scheme = overrides.scheme !== undefined
    ? overrides.scheme
    : yes
      ? toScheme(projectName)
      : await ui.askText({
          message: copy.scheme.message,
          defaultValue: toScheme(projectName),
          validate: validateScheme,
        });

  const bundleId = overrides.bundleId !== undefined
    ? overrides.bundleId
    : yes
      ? toBundleId(projectName)
      : await ui.askText({
          message: copy.bundleId.message,
          defaultValue: toBundleId(projectName),
          validate: validateBundleId,
        });

  const teamId = overrides.teamId !== undefined
    ? overrides.teamId
    : yes
      ? ""
      : await ui.askText({
          message: copy.teamId.message,
          defaultValue: "",
          validate: validateTeamId,
        });

  ui.rail.step(3, 5, "Surfaces");

  // Live Activity + Dynamic Island always ship — they're the load-bearing
  // surface this template was built around. Home and control widgets are
  // independent opt-ins; deselecting them strips their Swift target files,
  // fixtures, harness sections, and (in add-to-existing) entitlements.
  const homeWidget = overrides.homeWidget !== undefined
    ? overrides.homeWidget
    : yes
      ? true
      : await ui.askConfirm({
          message: copy.surfaces.homeWidget.message,
          defaultValue: true,
        });

  const controlWidget = overrides.controlWidget !== undefined
    ? overrides.controlWidget
    : yes
      ? true
      : await ui.askConfirm({
          message: copy.surfaces.controlWidget.message,
          defaultValue: true,
        });

  const installNow = overrides.installNow !== undefined
    ? overrides.installNow
    : yes
      ? true
      : await ui.askSelect({
          message: copy.install.message,
          defaultValue: true,
          options: [
            { value: true, label: copy.install.yes, hint: copy.install.yesHint },
            { value: false, label: copy.install.no },
          ],
        });

  // --yes skips the recap + confirmation; the user already knows what they
  // typed. Interactive runs always recap and confirm.
  if (!yes) {
    ui.rail.step(4, 5, "Confirm");

    // Recap — single stdout.write block. Cannot be redrawn over.
    const recapBody = [
      `name          ${pc.bold(projectName)}`,
      `scheme        ${pc.bold(scheme)}`,
      `bundle        ${pc.bold(bundleId)}`,
      `team id       ${teamId ? pc.bold(teamId) : pc.dim("skip — set later in app.json")}`,
      `home widget   ${homeWidget ? pc.bold("yes") : pc.dim("no")}`,
      `control       ${controlWidget ? pc.bold("yes") : pc.dim("no")}`,
      `install       ${installNow ? pc.bold("yes") : pc.dim("no")}`,
    ].join("\n");
    ui.section("Recap", recapBody);

    const proceed = await ui.askConfirm({
      message: copy.confirm.message,
      defaultValue: true,
    });

    if (!proceed) {
      ui.log.info("Starting over.");
      return runPrompts({ initialName: projectName, overrides, yes, ui });
    }
  }

  return {
    projectName,
    scheme,
    bundleId,
    teamId: teamId || null,
    surfaces: { homeWidget, controlWidget },
    installNow,
    // Pass through the New Architecture override only when the user supplied
    // a flag. Interactive runs that don't pass --new-arch / --no-new-arch
    // accept the template default (Expo's own default) and never need to
    // touch app.json's newArchEnabled key.
    ...(overrides.newArchEnabled !== undefined
      ? { newArchEnabled: overrides.newArchEnabled }
      : {}),
  };
}
