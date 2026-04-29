#!/usr/bin/env node
import { intro, log } from "@clack/prompts";
import { parseArgs } from "node:util";
import path from "node:path";
import pc from "picocolors";
import { renderBanner } from "../src/banner.mjs";
import { errors, welcome } from "../src/copy.mjs";
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
import { runExistingTasks, runTasks } from "../src/run-tasks.mjs";
import { targetDirState } from "../src/scaffold.mjs";
import { renderExistingSuccess, renderSuccess } from "../src/success.mjs";
import { loadTemplateManifest } from "../src/template-manifest.mjs";

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

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
const initialName = positionals[0]
  ? path.basename(positionals[0]).toLowerCase().replace(/[^a-z0-9-]/g, "-")
  : undefined;

const manifest = loadTemplateManifest();

renderBanner();
intro(pc.bold(welcome));

const preflight = await runPreflight({ manifest });
if (preflight.failures.length > 0) {
  renderFailures(preflight.failures);
  process.exit(1);
}
renderPassed(preflight.passed);
if (preflight.warnings.length > 0) {
  renderWarnings(preflight.warnings);
}

const mode = detectMode({ cwd: process.cwd(), targetName: initialName });

if (mode.kind === MODE.EXISTING_NON_EXPO) {
  renderRefuse(mode);
  process.exit(2);
}

if (mode.kind === MODE.EXISTING_EXPO) {
  const result = await runExistingExpoPrompts({ evidence: mode.evidence, manifest });
  const packageManager = result.evidence.packageManager ?? "pnpm";

  logger.open();

  let summary;
  try {
    summary = await runExistingTasks({
      evidence: result.evidence,
      plan: result.plan,
      packageManager,
      installNow: result.installNow,
      manifest,
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
const config = await runPrompts({ initialName });

const dirState = targetDirState(config.projectName);
if (!dirState.ok) {
  log.error(errors.dirNotEmpty(config.projectName));
  process.exit(1);
}

logger.open();

try {
  await runTasks({ config, target: dirState.target });
} catch (err) {
  if (interrupted) {
    log.warn(errors.installInterrupted(config.projectName));
  } else {
    log.error(errors.installFailed(config.projectName));
  }
  log.message(pc.dim(`Full log: ${logger.getPath()}`));
  process.exit(1);
}

renderSuccess(config);
