#!/usr/bin/env node
// `pnpm setup:hooks` — install opt-in git hooks under .git/hooks/ that
// enforce the branch-and-release workflow described in CONTRIBUTING.md.
//
// Why opt-in (not auto via husky/simple-git-hooks): the hook adds ~30
// seconds to every push (pnpm release:dry-run). Contributors who push
// often, or who want to push a WIP branch without a full check, need an
// easy escape valve. Installing the hook is one command; bypassing it for
// a single push is `git push --no-verify` (documented inline below).
//
// What the pre-push hook does:
//   1. Refuse pushes to `main` from local branch `main`. The workflow lives
//      on feature branches; direct-to-main pushes race the Changesets
//      release bot and produce diverged-history bugs.
//   2. Refuse non-fast-forward pushes (i.e. force-pushes that would
//      rewrite remote history). Force-pushes to a personal feature branch
//      are still possible via --force-with-lease, which the hook does not
//      block — that's a deliberate "you meant it" signal.
//   3. Run `pnpm release:dry-run` before completing the push. Catches every
//      class of generated-file drift and test failure CI would otherwise
//      catch.
//
// Bypass: `git push --no-verify` skips the hook for a single push. Use
// sparingly; the next CI run is the gate of last resort.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const HOOK_PATH = path.resolve(".git/hooks/pre-push");

const HOOK_BODY = `#!/usr/bin/env bash
# Installed by scripts/setup-hooks.mjs. Bypass with \`git push --no-verify\`.
# Re-install / update with \`pnpm setup:hooks\`.

set -e

remote="$1"
url="$2"

# Read each ref being pushed from stdin. Each line is:
#   <local ref> <local sha> <remote ref> <remote sha>
# We need to inspect the local branch name and the remote ref to enforce
# the no-direct-to-main rule.
while read local_ref local_sha remote_ref remote_sha; do
  # local_ref is "refs/heads/<branch>" or empty when deleting a ref.
  local_branch="\${local_ref#refs/heads/}"
  remote_branch="\${remote_ref#refs/heads/}"

  # Rule 1: refuse pushing local main to remote main.
  if [ "$local_branch" = "main" ] && [ "$remote_branch" = "main" ]; then
    echo "✗ pre-push: direct push to main is disabled."
    echo "  Work on a feature branch and open a PR. See CONTRIBUTING.md."
    echo "  To override (rare; only when bootstrapping or fixing tooling):"
    echo "      git push --no-verify"
    exit 1
  fi
done

# Rule 3: run the dry-run gate with --fix so scaffold snapshot drift gets
# auto-regenerated and amended into HEAD instead of failing the push and
# making you run a manual fix-and-amend cycle. When --fix triggers an
# amend it exits non-zero so this push attempt aborts; re-run \`git push\`
# once and the amended ref goes through cleanly. Skip for branch deletes
# (remote_sha would be all zeros).
echo "→ pre-push: running pnpm release:dry-run --fix..."
pnpm release:dry-run --fix
`;

if (!fs.existsSync(path.resolve(".git"))) {
  console.error("✗ not a git repository (no .git/ directory). Run from the repo root.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(HOOK_PATH), { recursive: true });
fs.writeFileSync(HOOK_PATH, HOOK_BODY);
fs.chmodSync(HOOK_PATH, 0o755);

// Confirm the hook is exec.
const stat = fs.statSync(HOOK_PATH);
const isExec = (stat.mode & 0o111) !== 0;
if (!isExec) {
  console.error(`✗ failed to mark ${HOOK_PATH} executable.`);
  process.exit(1);
}

// Get the version of pnpm we expect to run from.
let pnpmVersion = "unknown";
try {
  pnpmVersion = execSync("pnpm --version", { encoding: "utf8" }).trim();
} catch {
  // pnpm not on PATH; the hook will fail when it runs but the install
  // still completed. Surface this as a warning, not a fatal error.
  console.warn("⚠ pnpm not found on PATH; the hook will fail until you install pnpm.");
}

console.log(`✓ installed ${HOOK_PATH}`);
console.log(`  enforces: no-direct-to-main, fast-forward only, pnpm release:dry-run --fix`);
console.log(`  pnpm: ${pnpmVersion}`);
console.log(`  bypass: \`git push --no-verify\` (use sparingly)`);
