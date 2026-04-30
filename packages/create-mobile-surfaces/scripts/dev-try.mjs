#!/usr/bin/env node
// Spawn the CLI interactively against a fresh tempdir so you can feel the
// real UX — banner, prompts, preflight, plan recap, success screen — without
// polluting cwd or leaving artifacts in the repo.
//
// Variants:
//   node scripts/dev-try.mjs            # greenfield (empty tempdir)
//   node scripts/dev-try.mjs --existing # add-mode (tempdir prepopulated as a
//                                       #   minimal fake Expo project)
//
// stdio is inherited so prompts work; the spawned CLI is just our own
// bin/index.mjs running with cwd set to the tempdir.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { existing: { type: "boolean", default: false } },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntrypoint = path.resolve(__dirname, "..", "bin", "index.mjs");

const prefix = values.existing ? "cms-try-existing-" : "cms-try-";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

if (values.existing) {
  // Minimal fake Expo project — enough to make detectMode return EXISTING_EXPO
  // and let planChanges build a non-trivial delta. Mirror the shape the
  // existing-mode smoke uses so the experiences stay aligned.
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify(
      {
        name: "fake-host",
        dependencies: { expo: "~54.0.0", "expo-router": "^4.0.0" },
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(tmp, "app.json"),
    JSON.stringify(
      {
        expo: {
          name: "Fake Host",
          slug: "fake-host",
          ios: { bundleIdentifier: "com.acme.fakehost", deploymentTarget: "15.0" },
        },
      },
      null,
      2,
    ) + "\n",
  );
}

console.log(`\n[try] mode: ${values.existing ? "add-to-existing" : "greenfield"}`);
console.log(`[try] cwd:  ${tmp}`);
if (values.existing) {
  // The synthesized fake project is a minimal package.json + app.json — just
  // enough to exercise mode detection, planning, and the apply step. It does
  // NOT have react/react-native/entrypoints, so a real `expo prebuild` will
  // fail against it. Pick "No, I'll run them myself" on the install prompt
  // if you only want to feel the screens.
  console.log(`[try] note: pick "No, I'll run them myself" — the synthesized`);
  console.log(`[try]       project is too minimal for prebuild to actually`);
  console.log(`[try]       succeed; the apply step itself is what we're testing.`);
}
console.log("");

const child = spawn("node", [cliEntrypoint], {
  cwd: tmp,
  stdio: "inherit",
});

child.on("exit", (code) => {
  const exitCode = code ?? 0;
  if (exitCode === 0) {
    console.log(`\n[try] artifact at: ${tmp}`);
    console.log(`[try] cleanup:     rm -rf "${tmp}"`);
  } else {
    console.log(`\n[try] CLI exited with code ${exitCode}.`);
    console.log(`[try] tempdir:     ${tmp}`);
  }
  process.exit(exitCode);
});
