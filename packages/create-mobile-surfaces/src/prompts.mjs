// The greenfield prompt flow. Returns a config object the rest of the CLI
// uses to materialize the project. UI primitives come from ./ui.mjs which
// wraps @inquirer/prompts and ora — no clack, no redraw bookkeeping.

import pc from "picocolors";
import { prompts as copy } from "./copy.mjs";
import { askConfirm, askSelect, askText, log, rail, section } from "./ui.mjs";
import {
  toBundleId,
  toScheme,
  validateBundleId,
  validateProjectSlug,
  validateScheme,
  validateTeamId,
} from "./validators.mjs";

export async function runPrompts({ initialName }) {
  rail.step(2, 4, "Project basics");

  const projectName = await askText({
    message: copy.projectName.message,
    defaultValue: initialName ?? "lockscreen-demo",
    validate: validateProjectSlug,
  });

  const scheme = await askText({
    message: copy.scheme.message,
    defaultValue: toScheme(projectName),
    validate: validateScheme,
  });

  const bundleId = await askText({
    message: copy.bundleId.message,
    defaultValue: toBundleId(projectName),
    validate: validateBundleId,
  });

  const teamId = await askText({
    message: copy.teamId.message,
    defaultValue: "",
    validate: validateTeamId,
  });

  const installNow = await askSelect({
    message: copy.install.message,
    defaultValue: true,
    options: [
      { value: true, label: copy.install.yes, hint: copy.install.yesHint },
      { value: false, label: copy.install.no },
    ],
  });

  rail.step(3, 4, "Confirm");

  // Recap — single stdout.write block. Cannot be redrawn over.
  const recapBody = [
    `name        ${pc.bold(projectName)}`,
    `scheme      ${pc.bold(scheme)}`,
    `bundle      ${pc.bold(bundleId)}`,
    `team id     ${teamId ? pc.bold(teamId) : pc.dim("skip — set later in app.json")}`,
    `install     ${installNow ? pc.bold("yes") : pc.dim("no")}`,
  ].join("\n");
  section("Recap", recapBody);

  const proceed = await askConfirm({
    message: copy.confirm.message,
    defaultValue: true,
  });

  if (!proceed) {
    log.info("Starting over.");
    return runPrompts({ initialName: projectName });
  }

  return {
    projectName,
    scheme,
    bundleId,
    teamId: teamId || null,
    installNow,
  };
}
