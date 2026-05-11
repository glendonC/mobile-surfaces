// The existing-monorepo-no-Expo prompt flow. The user is sitting at the root
// of a TS monorepo (workspaces declared, no Expo, no apps/mobile/) and we'll
// scaffold apps/mobile/ inside their workspace. Distinct from existing-expo
// (which patches an already-Expo app) and from greenfield (which writes a
// brand-new repo on top of an empty cwd).

import path from "node:path";
import pc from "picocolors";
import { cancelled, monorepo as monorepoCopy, prompts as copy } from "./copy.mjs";
import { EXIT_CODES } from "./exit-codes.mjs";
import * as defaultUi from "./ui.mjs";
import {
  toBundleId,
  toScheme,
  toSwiftPrefix,
  validateBundleId,
  validateProjectSlug,
  validateScheme,
  validateTeamId,
} from "./validators.mjs";

const DEFAULT_SURFACES = Object.freeze({
  homeWidget: true,
  controlWidget: true,
});

// Plan a monorepo scaffold. Mirrors planChanges from existing-expo.mjs but
// for the case where we're adding apps/mobile/ wholesale instead of patching
// an already-Expo app config.
export function planMonorepoScaffold({ evidence, manifest, config }) {
  const swiftPrefix = toSwiftPrefix(config.projectName);
  return {
    appsMobileDest: path.join(evidence.cwd, "apps", "mobile"),
    packagesToInstall: (manifest.addPackages ?? [])
      .filter((p) => !p.workspace)
      .map((p) => p.name),
    packagesSkipped: (manifest.addPackages ?? [])
      .filter((p) => p.workspace)
      .map((p) => p.name),
    workspaceGlobsToAdd: evidence.workspaceGlobs.includes("apps/*")
      ? []
      : ["apps/*"],
    workspaceKind: evidence.workspaceKind,
    identity: {
      name: config.projectName,
      slug: config.projectName,
      scheme: config.scheme,
      bundleId: config.bundleId,
      swiftPrefix,
      widgetTarget: `${swiftPrefix}Widget`,
    },
    surfaces: { ...(config.surfaces ?? DEFAULT_SURFACES) },
  };
}

function renderFoundRecap(evidence, ui) {
  const lines = [
    pc.bold("What we found"),
    "",
    `  workspace     ${pc.bold(evidence.packageName)}`,
    `  workspace via ${pc.bold(
      evidence.workspaceKind === "pnpm-workspace"
        ? "pnpm-workspace.yaml"
        : "package.json workspaces",
    )}`,
  ];
  // Only show globs when the host has declared some. Printing "(none)" here
  // read as "we found no globs" — which is correct but unhelpful, since the
  // apply step will add apps/* on its own. Hiding the line keeps the recap
  // about positively-found evidence only.
  if (evidence.workspaceGlobs.length > 0) {
    lines.push(`  globs         ${pc.dim(evidence.workspaceGlobs.join(", "))}`);
  }
  lines.push(`  package mgr   ${pc.bold(evidence.packageManager ?? "unknown")}`);
  lines.push("");
  ui.rail.block(lines.join("\n"));
}

function renderPlanRecap(plan, ui) {
  const lines = [pc.bold("Changes to apply"), ""];

  // Echo the surface selections so the user sees their choices reflected
  // before "Apply these changes?". Live activity + dynamic island always
  // ship; only home + control widgets are toggleable.
  lines.push("  " + pc.bold("surfaces"));
  lines.push(`    live activity + dynamic island  ${pc.dim("(always)")}`);
  lines.push(`    home widget                     ${plan.surfaces.homeWidget ? pc.bold("yes") : pc.dim("no")}`);
  lines.push(`    control widget                  ${plan.surfaces.controlWidget ? pc.bold("yes") : pc.dim("no")}`);
  lines.push("");

  lines.push("  " + pc.bold("new files"));
  lines.push(`    apps/mobile/  (Expo app + widget target)`);
  lines.push(`    apps/mobile/targets/widget/`);
  lines.push("");

  if (plan.workspaceGlobsToAdd.length > 0) {
    lines.push("  " + pc.bold("workspace updates"));
    const target =
      plan.workspaceKind === "pnpm-workspace"
        ? "pnpm-workspace.yaml"
        : "package.json (workspaces)";
    for (const g of plan.workspaceGlobsToAdd) {
      lines.push(`    + ${g}  (in ${target})`);
    }
    lines.push("");
  }

  if (plan.packagesToInstall.length > 0) {
    lines.push("  " + pc.bold("dependencies (in apps/mobile/package.json)"));
    for (const name of plan.packagesToInstall) {
      lines.push(`    ${name}`);
    }
    lines.push("");
  }

  lines.push("  " + pc.bold("won't touch"));
  lines.push("    your root package.json, tsconfig.json, lint, or prettier configs");
  lines.push("");

  ui.rail.block(lines.join("\n"));
}

export async function runMonorepoPrompts({ evidence, manifest, overrides = {}, yes = false, ui = defaultUi }) {
  ui.rail.step(2, 5, "Detection");
  ui.rail.line(monorepoCopy.intro);
  ui.rail.blank();
  renderFoundRecap(evidence, ui);

  // Identity prompts. Same shape as greenfield since this mode also writes
  // a new Expo app from scratch — the user has no existing identity for us
  // to recap.
  const projectName = overrides.projectName !== undefined
    ? overrides.projectName
    : await ui.askText({
        message: copy.projectName.message,
        defaultValue: "lockscreen-demo",
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

  const teamIdRaw = overrides.teamId !== undefined
    ? overrides.teamId
    : yes
      ? ""
      : await ui.askText({
          message: copy.teamId.message,
          defaultValue: "",
          validate: validateTeamId,
        });
  const teamId = teamIdRaw && teamIdRaw.length > 0 ? teamIdRaw : null;

  ui.rail.step(3, 5, "Surfaces");

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
          message: copy.installExisting.message,
          defaultValue: true,
          options: [
            { value: true, label: copy.installExisting.yes, hint: copy.installExisting.yesHint },
            { value: false, label: copy.installExisting.no },
          ],
        });

  const config = {
    projectName,
    scheme,
    bundleId,
    teamId,
    surfaces: { homeWidget, controlWidget },
    installNow,
    ...(overrides.newArchEnabled !== undefined
      ? { newArchEnabled: overrides.newArchEnabled }
      : {}),
  };

  const plan = planMonorepoScaffold({ evidence, manifest, config });

  ui.rail.step(4, 5, "Plan");
  renderPlanRecap(plan, ui);

  if (!yes) {
    const proceed = await ui.askConfirm({
      message: copy.confirmExisting.message,
      defaultValue: true,
    });
    if (!proceed) {
      ui.log.message(pc.dim(cancelled));
      process.exit(EXIT_CODES.SUCCESS);
    }
  }

  return { mode: "existing-monorepo-no-expo", evidence, config, plan };
}
