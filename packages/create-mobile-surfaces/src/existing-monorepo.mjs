// The existing-monorepo-no-Expo prompt flow. The user is sitting at the root
// of a TS monorepo (workspaces declared, no Expo, no apps/mobile/) and we'll
// scaffold apps/mobile/ inside their workspace. Distinct from existing-expo
// (which patches an already-Expo app) and from greenfield (which writes a
// brand-new repo on top of an empty cwd).

import path from "node:path";
import pc from "picocolors";
import { cancelled, monorepo as monorepoCopy, prompts as copy } from "./copy.mjs";
import { askConfirm, askSelect, askText, log, rail, section } from "./ui.mjs";
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

function renderFoundRecap(evidence) {
  const lines = [
    pc.bold("What we found"),
    "",
    `  Workspace     ${pc.bold(evidence.packageName)}`,
    `  Workspace via ${pc.bold(
      evidence.workspaceKind === "pnpm-workspace"
        ? "pnpm-workspace.yaml"
        : "package.json workspaces",
    )}`,
    `  Globs         ${pc.dim(evidence.workspaceGlobs.join(", ") || "(none)")}`,
    `  Package mgr   ${pc.bold(evidence.packageManager ?? "unknown")}`,
    "",
  ];
  rail.block(lines.join("\n"));
}

function renderPlanRecap(plan) {
  const lines = [pc.bold("What I'll add"), ""];

  lines.push("  " + pc.bold("New files"));
  lines.push(`    apps/mobile/  (Expo app + widget target)`);
  if (plan.surfaces.homeWidget) {
    lines.push(`    apps/mobile/targets/widget/  (live activity + home + control widgets)`);
  } else if (plan.surfaces.controlWidget) {
    lines.push(`    apps/mobile/targets/widget/  (live activity + control widget)`);
  } else {
    lines.push(`    apps/mobile/targets/widget/  (live activity only)`);
  }
  lines.push("");

  if (plan.workspaceGlobsToAdd.length > 0) {
    lines.push("  " + pc.bold("Workspace updates"));
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
    lines.push("  " + pc.bold("Dependencies (in apps/mobile/package.json)"));
    for (const name of plan.packagesToInstall) {
      lines.push(`    ${name}`);
    }
    lines.push("");
  }

  lines.push("  " + pc.bold("We won't touch"));
  lines.push("    your root package.json, tsconfig.json, lint, or prettier configs");
  lines.push("");

  rail.block(lines.join("\n"));
}

export async function runMonorepoPrompts({ evidence, manifest, overrides = {}, yes = false }) {
  rail.step(2, 5, "Detection");
  rail.line(monorepoCopy.intro);
  rail.blank();
  renderFoundRecap(evidence);

  // Identity prompts. Same shape as greenfield since this mode also writes
  // a new Expo app from scratch — the user has no existing identity for us
  // to recap.
  const projectName = overrides.projectName !== undefined
    ? overrides.projectName
    : await askText({
        message: copy.projectName.message,
        defaultValue: "lockscreen-demo",
        validate: validateProjectSlug,
      });

  const scheme = overrides.scheme !== undefined
    ? overrides.scheme
    : yes
      ? toScheme(projectName)
      : await askText({
          message: copy.scheme.message,
          defaultValue: toScheme(projectName),
          validate: validateScheme,
        });

  const bundleId = overrides.bundleId !== undefined
    ? overrides.bundleId
    : yes
      ? toBundleId(projectName)
      : await askText({
          message: copy.bundleId.message,
          defaultValue: toBundleId(projectName),
          validate: validateBundleId,
        });

  const teamIdRaw = overrides.teamId !== undefined
    ? overrides.teamId
    : yes
      ? ""
      : await askText({
          message: copy.teamId.message,
          defaultValue: "",
          validate: validateTeamId,
        });
  const teamId = teamIdRaw && teamIdRaw.length > 0 ? teamIdRaw : null;

  rail.step(3, 5, "Surfaces");

  const homeWidget = overrides.homeWidget !== undefined
    ? overrides.homeWidget
    : yes
      ? true
      : await askConfirm({
          message: copy.surfaces.homeWidget.message,
          defaultValue: true,
        });

  const controlWidget = overrides.controlWidget !== undefined
    ? overrides.controlWidget
    : yes
      ? true
      : await askConfirm({
          message: copy.surfaces.controlWidget.message,
          defaultValue: true,
        });

  const installNow = overrides.installNow !== undefined
    ? overrides.installNow
    : yes
      ? true
      : await askSelect({
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
  };

  const plan = planMonorepoScaffold({ evidence, manifest, config });

  rail.step(4, 5, "Plan");
  renderPlanRecap(plan);

  if (!yes) {
    const proceed = await askConfirm({
      message: "Apply these changes?",
      defaultValue: true,
    });
    if (!proceed) {
      log.message(pc.dim(cancelled));
      process.exit(0);
    }
  }

  return { mode: "existing-monorepo-no-expo", evidence, config, plan };
}
