#!/usr/bin/env node
// Dev-only smoke test: runs the scaffold steps directly into /tmp without
// going through the interactive prompts. Useful for verifying the scaffold
// pipeline (template materialize, rename, install, prebuild) in isolation.
//
// Usage:
//   node packages/create-mobile-surfaces/scripts/dev-smoke.mjs [--install]
//
// The default skips pnpm install and prebuild for speed; pass --install to
// run the full pipeline (slow).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import * as logger from "../src/logger.mjs";
import { runTasks } from "../src/run-tasks.mjs";
import { targetDirState } from "../src/scaffold.mjs";

const { values } = parseArgs({
  options: { install: { type: "boolean", default: false } },
});

const stamp = Date.now().toString(36);
const projectName = `ms-smoke-${stamp}`;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "create-mobile-surfaces-"));

process.chdir(tmpRoot);
console.log(`[smoke] running in ${tmpRoot}`);

const dirState = targetDirState(projectName);
if (!dirState.ok) {
  console.error(`[smoke] target ${dirState.target} not empty; aborting`);
  process.exit(1);
}

logger.open();
console.log(`[smoke] log at ${logger.getPath()}`);

const config = {
  projectName,
  scheme: "smoke",
  bundleId: `com.example.${projectName.replace(/-/g, "")}`,
  teamId: null,
  installNow: values.install,
};

console.log(`[smoke] config:`, config);

try {
  await runTasks({ config, target: dirState.target });
  console.log(`\n[smoke] ✓ scaffold complete at ${dirState.target}`);
} catch (err) {
  console.error(`\n[smoke] ✗ failed:`, err.message);
  console.error(`[smoke] log: ${logger.getPath()}`);
  process.exit(1);
}
