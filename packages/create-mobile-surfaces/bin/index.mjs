#!/usr/bin/env node
import pc from "picocolors";
import { renderBanner } from "../src/banner.mjs";
import { errors, welcome } from "../src/copy.mjs";
import { HELP_TEXT, parseCliFlags, resolveYesConfig, validateOverrides } from "../src/flags.mjs";
import * as logger from "../src/logger.mjs";
import { runExistingExpoPrompts } from "../src/existing-expo.mjs";
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
  runTasks,
} from "../src/run-tasks.mjs";
import { targetDirState } from "../src/scaffold.mjs";
import { renderExistingSuccess, renderSuccess } from "../src/success.mjs";
import { loadTemplateManifest } from "../src/template-manifest.mjs";
import { log, rail } from "../src/ui.mjs";

// Don't crash when output is piped to a reader that closes early.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
});

// Track Ctrl+C separately from other failures so the post-tasks renderer can
// say "we stopped, here's how to resume" instead of "something broke".
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
});

let parsed;
try {
  parsed = parseCliFlags(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`${err.message}\n\n${HELP_TEXT}`);
  process.exit(1);
}

if (parsed.help) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

const { initialName: positionalName, overrides, yes } = parsed;
// --name takes precedence over the positional arg as the project name seed.
const initialName = overrides.projectName ?? positionalName;

const overrideErrors = validateOverrides(overrides);
if (overrideErrors.length > 0) {
  process.stderr.write("Invalid flag values:\n");
  for (const err of overrideErrors) process.stderr.write(`  ${err}\n`);
  process.exit(1);
}

const manifest = loadTemplateManifest();

renderBanner();
rail.line(pc.bold(welcome));
rail.blank();

const preflight = await runPreflight({ manifest });
if (preflight.failures.length > 0) {
  renderFailures(preflight.failures);
  process.exit(1);
}
rail.step(1, 5, "Toolchain");
renderPassed(preflight.passed);
if (preflight.warnings.length > 0) {
  renderWarnings(preflight.warnings);
}
rail.blank();

const mode = detectMode({ cwd: process.cwd(), targetName: initialName });

if (mode.kind === MODE.EXISTING_NON_EXPO) {
  renderRefuse(mode);
  process.exit(2);
}

if (mode.kind === MODE.EXISTING_EXPO) {
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
    } else {
      log.error(errors.applyFailed);
    }
    log.message(pc.dim(`Full log: ${logger.getPath()}`));
    process.exit(1);
  }

  renderExistingSuccess({
    summary,
    evidence: result.evidence,
    packageManager,
    plan: result.plan,
  });
  process.exit(0);
}

// Greenfield path.
let config;
if (yes) {
  // Non-interactive: every required field must be supplied (or derivable).
  // resolveYesConfig collects errors so we can report them all at once.
  const yesOverrides = { ...overrides };
  if (yesOverrides.projectName === undefined && positionalName) {
    yesOverrides.projectName = positionalName;
  }
  const resolved = resolveYesConfig(yesOverrides);
  if (resolved.errors.length > 0) {
    process.stderr.write("--yes: cannot scaffold without these:\n");
    for (const err of resolved.errors) process.stderr.write(`  ${err}\n`);
    process.exit(1);
  }
  config = resolved.config;
} else {
  config = await runPrompts({ initialName, overrides, yes });
}

const dirState = targetDirState(config.projectName);
if (!dirState.ok) {
  log.error(errors.dirNotEmpty(config.projectName));
  process.exit(1);
}

logger.open();

rail.step(5, 5, "Build");
try {
  await runTasks({ config, target: dirState.target });
} catch (err) {
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
  process.exit(1);
}

renderSuccess(config);
