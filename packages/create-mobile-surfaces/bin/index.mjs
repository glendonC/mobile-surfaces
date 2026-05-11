#!/usr/bin/env node
import pc from "picocolors";
import { renderBanner } from "../src/banner.mjs";
import { errors, welcome } from "../src/copy.mjs";
import { EXIT_CODES } from "../src/exit-codes.mjs";
import { HELP_TEXT, parseCliFlags, resolveYesConfig, validateOverrides } from "../src/flags.mjs";
import * as logger from "../src/logger.mjs";
import { runExistingExpoPrompts } from "../src/existing-expo.mjs";
import { runMonorepoPrompts } from "../src/existing-monorepo.mjs";
import { detectMode, MODE, renderRefuse } from "../src/mode.mjs";
import {
  renderFailures,
  renderPassed,
  renderWarnings,
  runPreflight,
} from "../src/preflight.mjs";
import { runPrompts } from "../src/prompts.mjs";
import {
  COCOAPODS_MISSING_TAG,
  PNPM_MISSING_TAG,
  runExistingTasks,
  runMonorepoTasks,
  runTasks,
} from "../src/run-tasks.mjs";
import {
  makeStagingPath,
  promoteStaging,
  rollbackStaging,
  targetDirState,
} from "../src/scaffold.mjs";
import {
  renderExistingSuccess,
  renderMonorepoSuccess,
  renderSuccess,
} from "../src/success.mjs";
import { loadTemplateManifest } from "../src/template-manifest.mjs";
import { log, rail } from "../src/ui.mjs";

// EPIPE happens when the user pipes output through something that closes
// early (e.g. `... | head -20`). In that case there's no real error — exit
// 0 keeps the upstream tool well-behaved. But if a real error has already
// been recorded and a stale write *then* hits the closed pipe, exiting 0
// would silently mask the failure. Track recordedFailureCode and propagate
// it from the EPIPE handler.
let recordedFailureCode = 0;
function recordFailure(code) {
  // First wins so a later stdout flush can't overwrite the earlier signal.
  if (recordedFailureCode === 0) recordedFailureCode = code;
}
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") {
    process.exit(recordedFailureCode || EXIT_CODES.SUCCESS);
  }
});

// Track Ctrl+C separately from other failures so the post-tasks renderer can
// say "we stopped, here's how to resume" instead of "something broke".
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
});

// Wrap process.exit so every non-zero exit also feeds recordFailure, keeping
// the EPIPE handler's contract honest without sprinkling recordFailure() at
// every call site.
const originalExit = process.exit.bind(process);
process.exit = (code = 0) => {
  if (code !== 0) recordFailure(code);
  originalExit(code);
};

let parsed;
try {
  parsed = parseCliFlags(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`${err.message}\n\n${HELP_TEXT}`);
  process.exit(EXIT_CODES.USER_ERROR);
}

if (parsed.help) {
  process.stdout.write(HELP_TEXT);
  process.exit(EXIT_CODES.SUCCESS);
}

const { initialName: positionalName, overrides, yes } = parsed;
// --name takes precedence over the positional arg as the project name seed.
const initialName = overrides.projectName ?? positionalName;

const overrideErrors = validateOverrides(overrides);
if (overrideErrors.length > 0) {
  process.stderr.write("Invalid flag values:\n");
  for (const err of overrideErrors) process.stderr.write(`  ${err}\n`);
  process.exit(EXIT_CODES.USER_ERROR);
}

// loadTemplateManifest throws if the bundled tarball/manifest is missing or
// corrupt — exclusively a packaging issue with the published CLI, not a
// user or environment problem. TEMPLATE_ERROR makes that visible so CI can
// distinguish "you misconfigured something" from "the tool itself is broken."
let manifest;
try {
  manifest = loadTemplateManifest();
} catch (err) {
  process.stderr.write(`Template error: ${err.message}\n`);
  process.exit(EXIT_CODES.TEMPLATE_ERROR);
}

renderBanner();
rail.line(pc.bold(welcome));
rail.blank();

// Preflight runs per-branch rather than upfront. Refuse paths exit without
// touching it (no toolchain needed to print "we don't help here"), and
// --yes greenfield runs resolveYesConfig first so a malformed CLI invocation
// surfaces as USER_ERROR, not ENV_ERROR. Each work path still gates on
// preflight before any FS write or spawned tool.
async function runPreflightOrExit() {
  const preflight = await runPreflight({ manifest });
  if (preflight.failures.length > 0) {
    renderFailures(preflight.failures);
    process.exit(EXIT_CODES.ENV_ERROR);
  }
  rail.step(1, 5, "Toolchain");
  renderPassed(preflight.passed);
  if (preflight.warnings.length > 0) {
    renderWarnings(preflight.warnings);
  }
  rail.blank();
}

const mode = detectMode({ cwd: process.cwd(), targetName: initialName });

if (mode.kind === MODE.EXISTING_NON_EXPO) {
  renderRefuse(mode);
  // Refuse paths are user errors: the user pointed us at a directory we
  // can't help with. Was historically exit 2; remapped to USER_ERROR so the
  // 0/1/2/3/130 contract reads cleanly.
  process.exit(EXIT_CODES.USER_ERROR);
}

if (mode.kind === MODE.EXISTING_MONOREPO_NO_EXPO) {
  await runPreflightOrExit();
  const result = await runMonorepoPrompts({
    evidence: mode.evidence,
    manifest,
    overrides,
    yes,
  });
  const packageManager = result.evidence.packageManager ?? "pnpm";

  logger.open();

  rail.step(5, 5, "Apply");
  let summary;
  try {
    summary = await runMonorepoTasks({
      evidence: result.evidence,
      plan: result.plan,
      manifest,
      config: result.config,
      packageManager,
    });
  } catch (err) {
    if (interrupted) {
      log.warn(errors.applyInterrupted);
    } else if (err && err.tag === PNPM_MISSING_TAG) {
      log.error(err.message);
    } else if (err && err.tag === COCOAPODS_MISSING_TAG) {
      log.error(err.message);
    } else {
      log.error(errors.applyFailed);
    }
    log.message(pc.dim(`Full log: ${logger.getPath()}`));
    process.exit(interrupted ? EXIT_CODES.INTERRUPTED : EXIT_CODES.ENV_ERROR);
  }

  renderMonorepoSuccess({
    summary,
    evidence: result.evidence,
    config: result.config,
    packageManager,
  });
  process.exit(EXIT_CODES.SUCCESS);
}

if (mode.kind === MODE.EXISTING_EXPO) {
  await runPreflightOrExit();
  const result = await runExistingExpoPrompts({
    evidence: mode.evidence,
    manifest,
    overrides,
    yes,
  });
  const packageManager = result.evidence.packageManager ?? "pnpm";

  logger.open();

  rail.step(5, 5, "Apply");
  let summary;
  try {
    summary = await runExistingTasks({
      evidence: result.evidence,
      plan: result.plan,
      packageManager,
      installNow: result.installNow,
      manifest,
      teamId: result.teamId ?? null,
    });
  } catch (err) {
    if (interrupted) {
      log.warn(errors.applyInterrupted);
    } else if (err && err.tag === PNPM_MISSING_TAG) {
      log.error(err.message);
    } else if (err && err.tag === COCOAPODS_MISSING_TAG) {
      log.error(err.message);
    } else {
      log.error(errors.applyFailed);
    }
    log.message(pc.dim(`Full log: ${logger.getPath()}`));
    process.exit(interrupted ? EXIT_CODES.INTERRUPTED : EXIT_CODES.ENV_ERROR);
  }

  renderExistingSuccess({
    summary,
    evidence: result.evidence,
    packageManager,
    plan: result.plan,
  });
  process.exit(EXIT_CODES.SUCCESS);
}

// Greenfield path.
let config;
if (yes) {
  // Non-interactive: every required field must be supplied (or derivable).
  // resolveYesConfig collects errors so we can report them all at once.
  // Runs before preflight so a malformed --yes (e.g. missing --name) exits
  // as USER_ERROR rather than getting masked by an ENV_ERROR from a
  // toolchain check that doesn't matter yet.
  const yesOverrides = { ...overrides };
  if (yesOverrides.projectName === undefined && positionalName) {
    yesOverrides.projectName = positionalName;
  }
  const resolved = resolveYesConfig(yesOverrides);
  if (resolved.errors.length > 0) {
    process.stderr.write("--yes: cannot scaffold without these:\n");
    for (const err of resolved.errors) process.stderr.write(`  ${err}\n`);
    process.exit(EXIT_CODES.USER_ERROR);
  }
  await runPreflightOrExit();
  config = resolved.config;
} else {
  await runPreflightOrExit();
  config = await runPrompts({ initialName, overrides, yes });
}

const dirState = targetDirState(config.projectName);
if (!dirState.ok) {
  log.error(errors.dirNotEmpty(config.projectName));
  process.exit(EXIT_CODES.USER_ERROR);
}

logger.open();

rail.step(5, 5, "Build");
// Stage the whole pipeline (template extract, rename, install, prebuild)
// into a sibling temp dir so a partial failure never leaves a half-formed
// project at the user's chosen path. Promotion to the final target is the
// last step — until that rename happens, the path the user typed is still
// untouched. On any failure we rm -rf the staging dir.
const stagingPath = makeStagingPath(dirState.target);
try {
  await runTasks({ config, target: stagingPath });
  promoteStaging({ stagingPath, target: dirState.target });
} catch (err) {
  rollbackStaging({
    stagingPath,
    log: (msg) => log.message(pc.dim(msg)),
  });
  if (interrupted) {
    log.warn(errors.installInterrupted(config.projectName));
  } else if (err && err.tag === PNPM_MISSING_TAG) {
    log.error(errors.pnpmMissing(config.projectName));
  } else if (err && err.tag === COCOAPODS_MISSING_TAG) {
    log.error(errors.cocoapodsMissing(config.projectName));
  } else {
    log.error(errors.installFailed(config.projectName));
  }
  log.message(pc.dim(`Full log: ${logger.getPath()}`));
  process.exit(interrupted ? EXIT_CODES.INTERRUPTED : EXIT_CODES.ENV_ERROR);
}

renderSuccess(config);
