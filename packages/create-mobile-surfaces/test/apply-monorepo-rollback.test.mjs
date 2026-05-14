// Rollback contract for the existing-monorepo-no-Expo apply. applyMonorepo
// runs six mutating steps against the host workspace: steps 1-5 write inside
// the freshly-created apps/mobile/ subtree, step 6 edits one host file
// (pnpm-workspace.yaml or the root package.json). When any step throws, the
// host must return to its pre-apply state: apps/mobile/ removed (it did not
// exist before), the host workspace file restored byte-for-byte, and the
// backup directory cleaned up. On success the backup is committed (deleted).
//
// Modeled on apply-existing-rollback.test.mjs. The prepareSourceTree runner
// is injected so the rollback path can be exercised without materializing
// the real template tarball.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { applyMonorepo } from "../src/apply-monorepo.mjs";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-monorepo-rb-"));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

const HOST_PACKAGE_JSON = JSON.stringify(
  { name: "host-workspace", private: true },
  null,
  2,
);

const PNPM_WORKSPACE_ORIGINAL = "packages:\n  - 'packages/*'\n";

// Stage a fake pnpm-workspace host: a root package.json plus a
// pnpm-workspace.yaml that does NOT yet declare apps/*. apps/mobile/ does
// not exist (the precondition the EXISTING_MONOREPO_NO_EXPO mode enforces).
function stageHost() {
  fs.writeFileSync(path.join(tmp, "package.json"), HOST_PACKAGE_JSON);
  fs.writeFileSync(path.join(tmp, "pnpm-workspace.yaml"), PNPM_WORKSPACE_ORIGINAL);
  fs.mkdirSync(path.join(tmp, "packages"), { recursive: true });
  return {
    pkgPath: path.join(tmp, "package.json"),
    workspacePath: path.join(tmp, "pnpm-workspace.yaml"),
    appsMobileRoot: path.join(tmp, "apps", "mobile"),
  };
}

function evidenceForPnpm() {
  return {
    cwd: tmp,
    packageName: "host-workspace",
    packageManager: "pnpm",
    workspaceKind: "pnpm-workspace",
    workspacePath: path.join(tmp, "pnpm-workspace.yaml"),
    workspaceGlobs: ["packages/*"],
  };
}

const CONFIG = {
  projectName: "lockscreen-demo",
  scheme: "lockscreendemo",
  bundleId: "com.acme.lockscreendemo",
  teamId: null,
  surfaces: { homeWidget: true, controlWidget: true },
  installNow: false,
};

const MANIFEST = {
  addPackages: [
    { name: "@mobile-surfaces/surface-contracts", version: "3.0.0" },
  ],
};

// Build a minimal but structurally complete apps/mobile/ source tree the
// six apply steps can run against: app.json (step 4 reads/writes it),
// package.json (step 5 reads/writes it), and targets/widget/ with a couple
// of swift files (step 2's strip pass walks that dir). `badPackageJson`
// plants malformed JSON so step 5's JSON.parse throws mid-pipeline.
function fakePrepareSourceTree({ badPackageJson = false } = {}) {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cms-monorepo-rb-src-"));
    const appsMobile = path.join(root, "apps", "mobile");
    const widgetDir = path.join(appsMobile, "targets", "widget");
    fs.mkdirSync(widgetDir, { recursive: true });
    fs.writeFileSync(
      path.join(appsMobile, "app.json"),
      JSON.stringify(
        {
          expo: {
            name: "Mobile Surfaces",
            slug: "mobile-surfaces",
            scheme: "mobilesurfaces",
            ios: { bundleIdentifier: "com.example.mobilesurfaces" },
          },
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(appsMobile, "package.json"),
      badPackageJson
        ? "{ this is not valid json"
        : JSON.stringify(
            {
              name: "mobile-surfaces-app",
              dependencies: {
                "@mobile-surfaces/surface-contracts": "workspace:*",
              },
            },
            null,
            2,
          ) + "\n",
    );
    fs.writeFileSync(
      path.join(widgetDir, "MobileSurfacesActivityAttributes.swift"),
      "// MobileSurfaces widget attributes\n",
    );
    fs.writeFileSync(
      path.join(widgetDir, "MobileSurfacesWidgetBundle.swift"),
      "// MobileSurfaces widget bundle\n",
    );
    return {
      rootDir: root,
      cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
  };
}

// A prepareSourceTree whose materialized tree has no apps/mobile/ at all, so
// stageAndCopyAppsMobile (step 1) throws before any host mutation lands.
function fakePrepareSourceTreeMissingAppsMobile() {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cms-monorepo-rb-empty-"));
    return {
      rootDir: root,
      cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
  };
}

function backupDirsIn(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(".create-mobile-surfaces-backup-"));
}

describe("applyMonorepo rollback", () => {
  it("happy path commits, removes the backup dir, and applies all six steps", async () => {
    const { pkgPath, workspacePath, appsMobileRoot } = stageHost();
    const summary = await applyMonorepo({
      evidence: evidenceForPnpm(),
      config: CONFIG,
      manifest: MANIFEST,
      packageManager: "pnpm",
      runners: { prepareSourceTree: fakePrepareSourceTree() },
    });

    assert.equal(summary.rolledBack, false);
    assert.equal(summary.appsMobileCreated, true);
    assert.equal(summary.appJsonPatched, true);

    // apps/mobile/ exists and was patched with the user's identity.
    assert.ok(fs.existsSync(appsMobileRoot));
    const appJson = JSON.parse(
      fs.readFileSync(path.join(appsMobileRoot, "app.json"), "utf8"),
    );
    assert.equal(appJson.expo.name, "lockscreen-demo");
    assert.equal(appJson.expo.ios.bundleIdentifier, "com.acme.lockscreendemo");

    // Host workspace file gained the apps/* glob.
    const workspaceYaml = fs.readFileSync(workspacePath, "utf8");
    assert.match(workspaceYaml, /apps\/\*/);
    assert.match(workspaceYaml, /packages\/\*/, "existing glob preserved");

    // Root package.json was left alone (pnpm-workspace path edits the YAML).
    assert.equal(fs.readFileSync(pkgPath, "utf8"), HOST_PACKAGE_JSON);

    // No backup dir left behind.
    assert.deepEqual(backupDirsIn(tmp), []);
  });

  it("rolls back every file when a mid-pipeline step throws", async () => {
    const { pkgPath, workspacePath, appsMobileRoot } = stageHost();

    await assert.rejects(
      applyMonorepo({
        evidence: evidenceForPnpm(),
        config: CONFIG,
        manifest: MANIFEST,
        packageManager: "pnpm",
        // Malformed apps/mobile/package.json: step 1 copies the tree, steps
        // 2-4 mutate files inside it, then step 5's JSON.parse throws.
        runners: {
          prepareSourceTree: fakePrepareSourceTree({ badPackageJson: true }),
        },
      }),
      // JSON.parse on the malformed package.json.
      /JSON|Unexpected|token/i,
    );

    // The freshly-created apps/mobile/ subtree (steps 1-4's mutations) is
    // gone entirely.
    assert.equal(fs.existsSync(appsMobileRoot), false);

    // The host workspace file is byte-identical to its pre-apply state
    // (step 6 never ran; it was recorded before any mutation).
    assert.equal(fs.readFileSync(workspacePath, "utf8"), PNPM_WORKSPACE_ORIGINAL);
    assert.equal(fs.readFileSync(pkgPath, "utf8"), HOST_PACKAGE_JSON);

    // Backup dir cleaned up.
    assert.deepEqual(backupDirsIn(tmp), []);
  });

  it("removes the freshly-created apps/mobile/ directory on an early throw", async () => {
    const { workspacePath, appsMobileRoot } = stageHost();

    await assert.rejects(
      applyMonorepo({
        evidence: evidenceForPnpm(),
        config: CONFIG,
        manifest: MANIFEST,
        packageManager: "pnpm",
        // Source tree has no apps/mobile/, so step 1 throws.
        runners: {
          prepareSourceTree: fakePrepareSourceTreeMissingAppsMobile(),
        },
      }),
      /Template missing apps\/mobile\//,
    );

    // apps/mobile/ was recorded as a not-yet-existing dir; rollback removes
    // it even though step 1 threw before completing the copy.
    assert.equal(fs.existsSync(appsMobileRoot), false);
    // Host workspace untouched.
    assert.equal(fs.readFileSync(workspacePath, "utf8"), PNPM_WORKSPACE_ORIGINAL);
    // Backup dir cleaned up.
    assert.deepEqual(backupDirsIn(tmp), []);
  });

  it("does not leave a backup directory behind on success or failure", async () => {
    // Pin the user-visible side effect: after every apply, success or
    // failure, the host root contains no .create-mobile-surfaces-backup-*
    // directory. Reruns can rely on this.
    stageHost();

    // Failure run.
    await assert.rejects(
      applyMonorepo({
        evidence: evidenceForPnpm(),
        config: CONFIG,
        manifest: MANIFEST,
        packageManager: "pnpm",
        runners: {
          prepareSourceTree: fakePrepareSourceTreeMissingAppsMobile(),
        },
      }),
    );
    assert.deepEqual(backupDirsIn(tmp), []);

    // Success run (apps/mobile/ was removed by the rollback above, so the
    // EXISTING_MONOREPO_NO_EXPO precondition still holds).
    await applyMonorepo({
      evidence: evidenceForPnpm(),
      config: CONFIG,
      manifest: MANIFEST,
      packageManager: "pnpm",
      runners: { prepareSourceTree: fakePrepareSourceTree() },
    });
    assert.deepEqual(backupDirsIn(tmp), []);
  });
});
