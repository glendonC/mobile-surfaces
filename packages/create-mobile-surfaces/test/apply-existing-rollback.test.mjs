// Rollback contract for add-to-existing apply. When any of the three
// mutating steps throws (pnpm install fails, app.json write fails, widget
// rewrite throws), the user's project must return to its pre-apply state:
// package.json/lockfile restored, app.json restored, widget target dir
// removed, backup directory cleaned up.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { applyToExisting } from "../src/apply-existing.mjs";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-apply-rb-"));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

const APP_JSON_ORIGINAL = JSON.stringify(
  {
    expo: {
      name: "host",
      slug: "host",
      ios: { bundleIdentifier: "com.host.app" },
    },
  },
  null,
  2,
);

const PACKAGE_JSON_ORIGINAL = JSON.stringify(
  { name: "host", version: "0.1.0", dependencies: { expo: "55.0.0" } },
  null,
  2,
);

const PNPM_LOCK_ORIGINAL = "lockfileVersion: '9.0'\n";

function stageProject() {
  fs.writeFileSync(path.join(tmp, "package.json"), PACKAGE_JSON_ORIGINAL);
  fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), PNPM_LOCK_ORIGINAL);
  fs.writeFileSync(path.join(tmp, "app.json"), APP_JSON_ORIGINAL);
  return {
    pkgPath: path.join(tmp, "package.json"),
    lockPath: path.join(tmp, "pnpm-lock.yaml"),
    appJsonPath: path.join(tmp, "app.json"),
  };
}

function evidenceFor(appJsonPath) {
  return {
    cwd: tmp,
    config: {
      kind: "json",
      path: appJsonPath,
      parsed: JSON.parse(fs.readFileSync(appJsonPath, "utf8")),
    },
    packageName: "host-app",
  };
}

const PLAN = {
  packagesToAdd: [
    { name: "@mobile-surfaces/surface-contracts", version: "3.0.0" },
  ],
  appConfigKind: "json",
  appConfigPath: null,
  pluginsToAdd: [{ name: "@bacons/apple-targets" }],
  infoPlistToAdd: { NSSupportsLiveActivities: true },
  entitlementsToAdd: {
    "com.apple.security.application-groups": ["group.com.host.app"],
  },
  deploymentTargetTo: "17.2",
  appConfigManual: false,
  widgetTargetDir: "apps/mobile/targets/widget",
  willPrebuild: true,
  manualFollowups: [],
};

const MANIFEST = { widgetTargetDir: "apps/mobile/targets/widget" };

// Fake runAddPackages that mutates package.json so we can verify rollback
// undoes its edit, but defers throwing to a configurable hook.
function fakeRunAddPackages({ throwAfter = false } = {}) {
  return async ({ target, packages }) => {
    const pkgPath = path.join(target, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.dependencies = pkg.dependencies ?? {};
    for (const spec of packages) {
      const at = spec.lastIndexOf("@");
      const name = at > 0 ? spec.slice(0, at) : spec;
      const version = at > 0 ? spec.slice(at + 1) : "latest";
      pkg.dependencies[name] = version;
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    // pnpm rewrites the lockfile too. Simulate that so we can verify
    // rollback restores both files.
    fs.writeFileSync(path.join(target, "pnpm-lock.yaml"), "mutated-lock\n");
    if (throwAfter) throw new Error("simulated pnpm install failure");
  };
}

// Fake prepareSourceTree that materializes a tiny widget source tree so
// copyWidgetTarget has something to read. The cleanup hook removes it.
function fakePrepareSourceTree() {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cms-rb-src-"));
    const widgetSrc = path.join(root, "apps/mobile/targets/widget");
    fs.mkdirSync(widgetSrc, { recursive: true });
    fs.writeFileSync(
      path.join(widgetSrc, "MobileSurfacesActivityAttributes.swift"),
      "// host-app widget\n",
    );
    fs.writeFileSync(
      path.join(widgetSrc, "MobileSurfacesWidgetBundle.swift"),
      "// bundle\n",
    );
    return {
      rootDir: root,
      cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
  };
}

describe("applyToExisting rollback", () => {
  it("happy path commits and removes the backup directory", async () => {
    const { pkgPath, appJsonPath } = stageProject();
    const summary = await applyToExisting({
      evidence: evidenceFor(appJsonPath),
      plan: PLAN,
      packageManager: "pnpm",
      manifest: MANIFEST,
      runners: {
        runAddPackages: fakeRunAddPackages(),
        prepareSourceTree: fakePrepareSourceTree(),
      },
    });
    assert.equal(summary.rolledBack, false);
    assert.equal(summary.appJsonPatched, true);
    assert.equal(summary.widgetCopied, true);
    // No backup dir left behind.
    const backups = fs
      .readdirSync(tmp)
      .filter((n) => n.startsWith(".create-mobile-surfaces-backup-"));
    assert.deepEqual(backups, []);
    // package.json has the new dep.
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert.ok(pkg.dependencies["@mobile-surfaces/surface-contracts"]);
    // app.json was patched.
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    assert.equal(appJson.expo.ios.deploymentTarget, "17.2");
  });

  it("rolls back package.json and lockfile when pnpm add throws", async () => {
    const { pkgPath, lockPath, appJsonPath } = stageProject();
    await assert.rejects(
      applyToExisting({
        evidence: evidenceFor(appJsonPath),
        plan: PLAN,
        packageManager: "pnpm",
        manifest: MANIFEST,
        runners: {
          runAddPackages: fakeRunAddPackages({ throwAfter: true }),
          prepareSourceTree: fakePrepareSourceTree(),
        },
      }),
      /simulated pnpm install failure/,
    );
    // package.json and lockfile must be back to their originals.
    assert.equal(fs.readFileSync(pkgPath, "utf8"), PACKAGE_JSON_ORIGINAL);
    assert.equal(fs.readFileSync(lockPath, "utf8"), PNPM_LOCK_ORIGINAL);
    // app.json was never touched (pnpm step failed first).
    assert.equal(fs.readFileSync(appJsonPath, "utf8"), APP_JSON_ORIGINAL);
    // Backup dir cleaned up.
    const backups = fs
      .readdirSync(tmp)
      .filter((n) => n.startsWith(".create-mobile-surfaces-backup-"));
    assert.deepEqual(backups, []);
  });

  it("rolls back app.json and removes the widget dir when the widget step throws", async () => {
    const { pkgPath, lockPath, appJsonPath } = stageProject();
    const widgetDest = path.join(tmp, "targets/widget");
    // Inject a faulty prepareSourceTree-equivalent: source exists but the
    // strip step throws by way of an unwritable destination. Simpler to
    // wrap the source tree with a poison file that triggers later code.
    const sourceTree = fakePrepareSourceTree();
    const poisoned = async () => {
      const r = await sourceTree();
      // Replace widgetTargetDir on the source so copyWidgetTarget fails
      // mid-copy: source dir is non-existent so `Widget source missing`
      // throws AFTER the backup dir was recorded and the package install +
      // app.json patch have already committed mutations.
      return {
        ...r,
        rootDir: path.join(r.rootDir, "no-such-place"),
      };
    };
    await assert.rejects(
      applyToExisting({
        evidence: evidenceFor(appJsonPath),
        plan: PLAN,
        packageManager: "pnpm",
        manifest: MANIFEST,
        runners: {
          runAddPackages: fakeRunAddPackages(),
          prepareSourceTree: poisoned,
        },
      }),
      /Widget source missing/,
    );
    // All three files restored to originals.
    assert.equal(fs.readFileSync(pkgPath, "utf8"), PACKAGE_JSON_ORIGINAL);
    assert.equal(fs.readFileSync(lockPath, "utf8"), PNPM_LOCK_ORIGINAL);
    assert.equal(fs.readFileSync(appJsonPath, "utf8"), APP_JSON_ORIGINAL);
    // Widget destination was never created (source missing threw before copy).
    assert.equal(fs.existsSync(widgetDest), false);
    // Backup dir cleaned up.
    const backups = fs
      .readdirSync(tmp)
      .filter((n) => n.startsWith(".create-mobile-surfaces-backup-"));
    assert.deepEqual(backups, []);
  });

  it("removes a freshly-created widget directory when the rename step throws", async () => {
    const { pkgPath, lockPath, appJsonPath } = stageProject();
    const widgetDest = path.join(tmp, "targets/widget");
    // Drive applyWidgetRename to a deterministic throw. evidence.packageName
    // is "host-app", so deriveSwiftPrefixFromEvidence yields "HostApp" and
    // MobileSurfacesWidgetBundle.swift is slated to rename to
    // HostAppWidgetBundle.swift. We plant HostAppWidgetBundle.swift as a
    // *non-empty directory* in the source widget dir: it copies through to
    // the dest untouched (walkFiles only collects files, never the dir
    // itself), then fs.renameSync of the real .swift file onto that
    // directory path throws EISDIR. The rename happens AFTER copyWidgetTarget
    // created and recorded the dest widget dir, so this exercises the
    // "later step throws -> freshly-created dir is removed" rollback path.
    const sourceTree = async () => {
      const r = await fakePrepareSourceTree()();
      const widgetSrc = path.join(r.rootDir, "apps/mobile/targets/widget");
      const collisionDir = path.join(widgetSrc, "HostAppWidgetBundle.swift");
      fs.mkdirSync(collisionDir);
      fs.writeFileSync(path.join(collisionDir, "keep"), "non-empty\n");
      return r;
    };
    await assert.rejects(
      applyToExisting({
        evidence: evidenceFor(appJsonPath),
        plan: PLAN,
        packageManager: "pnpm",
        manifest: MANIFEST,
        runners: {
          runAddPackages: fakeRunAddPackages(),
          prepareSourceTree: sourceTree,
        },
      }),
      /EISDIR|illegal operation on a directory/,
    );
    // package.json, lockfile, and app.json are all restored to originals.
    assert.equal(fs.readFileSync(pkgPath, "utf8"), PACKAGE_JSON_ORIGINAL);
    assert.equal(fs.readFileSync(lockPath, "utf8"), PNPM_LOCK_ORIGINAL);
    assert.equal(fs.readFileSync(appJsonPath, "utf8"), APP_JSON_ORIGINAL);
    // The widget dir was created by copyWidgetTarget and recorded as a
    // freshly-created dir; rollback removes it entirely.
    assert.equal(fs.existsSync(widgetDest), false);
    // Backup dir cleaned up.
    const backups = fs
      .readdirSync(tmp)
      .filter((n) => n.startsWith(".create-mobile-surfaces-backup-"));
    assert.deepEqual(backups, []);
  });

  it("does not leave a backup directory behind on success or failure", async () => {
    // Pin the user-visible side effect: after every apply, success or
    // failure, the project root contains no .create-mobile-surfaces-backup-*
    // directory. Reruns can rely on this.
    const { appJsonPath } = stageProject();
    // Success run.
    await applyToExisting({
      evidence: evidenceFor(appJsonPath),
      plan: PLAN,
      packageManager: "pnpm",
      manifest: MANIFEST,
      runners: {
        runAddPackages: fakeRunAddPackages(),
        prepareSourceTree: fakePrepareSourceTree(),
      },
    });
    assert.equal(
      fs
        .readdirSync(tmp)
        .filter((n) => n.startsWith(".create-mobile-surfaces-backup-"))
        .length,
      0,
    );
  });

  it("rerun after a successful apply does not duplicate plugin entries (planChanges filters)", async () => {
    // planChanges (existing-expo.mjs) filters pluginsToAdd against the
    // current app.json, so a rerun after success effectively passes an
    // empty pluginsToAdd. The apply path is unchanged - we pin that
    // buildPatchedAppJson is invoked with the filtered plan, not the
    // original. This test is a defense-in-depth pin that rerunning the
    // CLI does not double-write plugins; the planner does the filtering.
    const { appJsonPath } = stageProject();
    await applyToExisting({
      evidence: evidenceFor(appJsonPath),
      plan: PLAN,
      packageManager: "pnpm",
      manifest: MANIFEST,
      runners: {
        runAddPackages: fakeRunAddPackages(),
        prepareSourceTree: fakePrepareSourceTree(),
      },
    });
    const afterFirst = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    assert.equal(afterFirst.expo.plugins.length, 1);

    // Reload evidence with the post-apply app.json so planChanges (if it
    // were called here) would filter the plugin out. We simulate the
    // planner's behavior by passing a plan with empty pluginsToAdd on the
    // rerun.
    const rerunPlan = { ...PLAN, pluginsToAdd: [] };
    await applyToExisting({
      evidence: evidenceFor(appJsonPath),
      plan: rerunPlan,
      packageManager: "pnpm",
      manifest: MANIFEST,
      runners: {
        runAddPackages: fakeRunAddPackages(),
        // Source tree is required; widgetDecision will conflict because
        // the dir is now populated.
        prepareSourceTree: fakePrepareSourceTree(),
      },
    });
    const afterSecond = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    assert.equal(afterSecond.expo.plugins.length, 1, "no duplicate plugin entries on rerun");
  });
});
