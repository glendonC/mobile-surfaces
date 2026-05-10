// The actual work: materialize a template into the target dir, run the
// rename script that already lives in the template, and (optionally) run
// pnpm install + expo prebuild. Each step shells out and streams to the
// install log; the caller wraps these in clack's tasks() for UI.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as logger from "./logger.mjs";
import { toSwiftPrefix } from "./validators.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where does the template live? In a published package, it's a tarball at
// ../template/template.tgz. In this monorepo, fall back to the repo root
// three levels up from this file.
export function resolveTemplateSource() {
  const tarball = path.resolve(__dirname, "..", "template", "template.tgz");
  if (fs.existsSync(tarball)) return { kind: "tarball", path: tarball };
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  if (fs.existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
    return { kind: "git", path: repoRoot };
  }
  throw new Error(
    `Couldn't find a template. Expected ${tarball} or a monorepo at ${repoRoot}.`,
  );
}

// Materialize the template into a directory we can read individual files from.
// Greenfield's copyTemplate writes the whole tree into the target; the
// add-to-existing flow only needs a few files (the widget target dir), so it
// stages into a temp dir and reads from there. Live mode skips the staging
// since the monorepo files are already on disk; the cleanup is then a no-op.
export async function prepareSourceTree() {
  const source = resolveTemplateSource();
  if (source.kind === "git") {
    return { rootDir: source.path, cleanup: () => {} };
  }
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-source-"));
  await runStreamed("tar", ["-xzf", source.path, "-C", rootDir]);
  return {
    rootDir,
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
  };
}

function runStreamed(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    logger.header(`${cmd} ${args.join(" ")}${opts?.cwd ? `  (cwd ${opts.cwd})` : ""}`);
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => logger.write(d.toString()));
    child.stderr.on("data", (d) => logger.write(d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const err = new Error(`${cmd} exited with code ${code}`);
      err.exitCode = code;
      err.command = `${cmd} ${args.join(" ")}`;
      reject(err);
    });
  });
}

export function targetDirState(projectName) {
  const target = path.resolve(process.cwd(), projectName);
  if (!fs.existsSync(target)) return { ok: true, target };
  const entries = fs.readdirSync(target);
  if (entries.length === 0) return { ok: true, target };
  return { ok: false, target };
}

// Pick a sibling staging path next to where the final project will land. We
// stage there (rather than os.tmpdir()) so the final atomic rename is a
// same-filesystem move — no cross-device copy if /tmp is on a different
// volume. The basename keeps the projectName so anything that scans cwd
// can see what's going on while scaffolding is in flight.
//
// Caller is responsible for cleanup; on success they rename to `target`,
// on failure they rm -rf the staging path.
export function makeStagingPath(target) {
  const parent = path.dirname(target);
  const base = path.basename(target);
  return fs.mkdtempSync(path.join(parent, `.${base}.staging-`));
}

// Atomic-promote the staging tree to the final target. Both must live on
// the same filesystem (which makeStagingPath guarantees by placing staging
// alongside target). On Windows fs.renameSync would fail if target exists,
// but the prior targetDirState check already rejects that case for us.
export function promoteStaging({ stagingPath, target }) {
  fs.renameSync(stagingPath, target);
}

// Best-effort cleanup. We never want a rollback failure to mask the real
// error (the network blip, the missing pnpm, etc.) so swallow ENOENT and
// log everything else without throwing.
export function rollbackStaging({ stagingPath, log }) {
  try {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  } catch (err) {
    if (log) log(`Failed to roll back ${stagingPath}: ${err.message}`);
  }
}

export async function copyTemplate({ target }) {
  const source = resolveTemplateSource();
  fs.mkdirSync(target, { recursive: true });

  if (source.kind === "tarball") {
    await runStreamed("tar", ["-xzf", source.path, "-C", target]);
    return;
  }

  // Dev mode: stream a clean copy of the tracked repo via `git archive` so
  // we get exactly what would be published, ignoring node_modules and the
  // gitignored ios/ tree.
  await new Promise((resolve, reject) => {
    const archive = spawn("git", ["-C", source.path, "archive", "--format=tar", "HEAD"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const extract = spawn("tar", ["-x", "-C", target], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    archive.stdout.pipe(extract.stdin);
    archive.stderr.on("data", (d) => logger.write(d.toString()));
    archive.on("error", reject);
    extract.on("error", reject);
    extract.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`tar -x exited with code ${code}`));
    });
  });
}

export async function renameIdentity({ target, config }) {
  const swiftPrefix = toSwiftPrefix(config.projectName);
  const widgetTarget = `${swiftPrefix}Widget`;
  // --skip-verify: rename runs before `pnpm install`, so the post-rename
  // surface:check pass would fail importing zod from packages/surface-contracts.
  // The user's first install + surface:check covers verification end-to-end.
  await runStreamed(
    "node",
    [
      "scripts/rename-starter.mjs",
      `--name=${config.projectName}`,
      `--scheme=${config.scheme}`,
      `--bundle-id=${config.bundleId}`,
      `--widget-target=${widgetTarget}`,
      `--swift-prefix=${swiftPrefix}`,
      `--slug=${config.projectName}`,
      "--force",
      "--skip-verify",
    ],
    { cwd: target },
  );

  // Apply both app.json patches in a single read-modify-write. The rename
  // script already wrote app.json in this run, and applyAppleTeamId /
  // applyNewArchEnabled each do their own r-m-w cycle; calling them
  // sequentially adds two more reads of a file we just touched. Their
  // exported forms remain for unit tests; production goes through this
  // batched path.
  applyAppJsonPatches({
    target,
    teamId: config.teamId,
    newArchEnabled: config.newArchEnabled,
  });
}

// Internal: one read-modify-write applying both teamId and newArchEnabled
// patches. Mirrors applyAppleTeamId + applyNewArchEnabled semantics: skips
// when the file or expected keys are missing; strips the upstream
// "XXXXXXXXXX" placeholder when teamId is null/empty. Returns true when any
// change was written.
function applyAppJsonPatches({ target, teamId, newArchEnabled }) {
  const appJsonPath = path.join(target, "apps", "mobile", "app.json");
  if (!fs.existsSync(appJsonPath)) return false;
  const j = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  if (!j.expo) return false;
  let changed = false;

  if (j.expo.ios) {
    if (teamId) {
      j.expo.ios.appleTeamId = teamId;
      changed = true;
    } else if (j.expo.ios.appleTeamId === "XXXXXXXXXX") {
      delete j.expo.ios.appleTeamId;
      changed = true;
    }
  }

  if (newArchEnabled !== undefined) {
    j.expo.newArchEnabled = newArchEnabled;
    changed = true;
  }

  if (!changed) return false;
  fs.writeFileSync(appJsonPath, JSON.stringify(j, null, 2) + "\n");
  return true;
}

// Pure-ish: read apps/mobile/app.json, set expo.newArchEnabled to the user's
// choice, write back. Only called when config.newArchEnabled is set — i.e.
// when the user passed --new-arch or --no-new-arch. If they passed neither,
// the template's app.json default (Expo's own default) wins.
export function applyNewArchEnabled({ target, newArchEnabled }) {
  const appJsonPath = path.join(target, "apps", "mobile", "app.json");
  if (!fs.existsSync(appJsonPath)) return false;
  const j = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  if (!j.expo) return false;
  j.expo.newArchEnabled = newArchEnabled;
  fs.writeFileSync(appJsonPath, JSON.stringify(j, null, 2) + "\n");
  return true;
}

// Pure-ish: read apps/mobile/app.json, set or strip appleTeamId, write back.
// Exported so the (no-shellout) behavior is unit-testable. When teamId is
// provided we write it; when null/empty we strip the upstream "XXXXXXXXXX"
// placeholder so the user gets expo's missing-team-id error instead of a
// confusing "invalid team id" failure at signing time.
export function applyAppleTeamId({ target, teamId }) {
  const appJsonPath = path.join(target, "apps", "mobile", "app.json");
  if (!fs.existsSync(appJsonPath)) return false;
  const j = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  if (!j.expo?.ios) return false;
  if (teamId) {
    j.expo.ios.appleTeamId = teamId;
  } else if (j.expo.ios.appleTeamId === "XXXXXXXXXX") {
    delete j.expo.ios.appleTeamId;
  } else {
    return false;
  }
  fs.writeFileSync(appJsonPath, JSON.stringify(j, null, 2) + "\n");
  return true;
}

// Per-package-manager command mapping. Each manager has its own verb for
// "install everything from the lockfile" vs "add these packages to deps."
// Add-mode uses `add`; greenfield uses `install` since the template ships
// with a pnpm lockfile and just needs resolution.
const PM_COMMANDS = Object.freeze({
  pnpm: {
    install: () => ["pnpm", ["install"]],
    add: (pkgs) => ["pnpm", ["add", ...pkgs]],
    runScript: (name) => ["pnpm", [name]],
  },
  npm: {
    install: () => ["npm", ["install"]],
    add: (pkgs) => ["npm", ["install", ...pkgs]],
    runScript: (name) => ["npm", ["run", name]],
  },
  yarn: {
    install: () => ["yarn", []],
    add: (pkgs) => ["yarn", ["add", ...pkgs]],
    runScript: (name) => ["yarn", [name]],
  },
  bun: {
    install: () => ["bun", ["install"]],
    add: (pkgs) => ["bun", ["add", ...pkgs]],
    runScript: (name) => ["bun", ["run", name]],
  },
});

function commandsFor(packageManager) {
  const set = PM_COMMANDS[packageManager];
  if (!set) throw new Error(`Unsupported package manager: ${packageManager}`);
  return set;
}

export async function runInstall({ target, packageManager = "pnpm" }) {
  const [cmd, args] = commandsFor(packageManager).install();
  await runStreamed(cmd, args, { cwd: target });
}

export async function runAddPackages({ target, packageManager = "pnpm", packages }) {
  if (!packages || packages.length === 0) return;
  const [cmd, args] = commandsFor(packageManager).add(packages);
  await runStreamed(cmd, args, { cwd: target });
}

export async function prebuildIos({ target, packageManager = "pnpm" }) {
  // The template's prebuild script is at `mobile:prebuild:ios` in the root
  // package.json. It works on any package manager that can run scripts.
  const [cmd, args] = commandsFor(packageManager).runScript("mobile:prebuild:ios");
  await runStreamed(cmd, args, { cwd: target });
}

// Prebuild for the existing-monorepo-no-Expo flow: the host has no
// mobile:prebuild:ios script, so invoke expo directly inside apps/mobile/.
// runStreamed inherits PATH so npx finds whichever expo the install just put
// in node_modules.
export async function prebuildIosInAppsMobile({ appsMobileRoot }) {
  await runStreamed("npx", ["expo", "prebuild", "--platform", "ios", "--clean"], {
    cwd: appsMobileRoot,
  });
}
