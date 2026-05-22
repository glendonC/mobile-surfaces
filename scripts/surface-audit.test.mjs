// End-to-end tests for scripts/surface-audit.mjs and the audit mode of the
// gate scripts it drives (MS013 App Group identity, MS029 ios/ gitignore).
//
// Before this suite, `pnpm surface:audit --root <foreign>` produced false
// positives: check-app-group-identity and check-ios-gitignore accepted --root
// but then hard-coded apps/mobile/ underneath it, so a foreign Expo project
// whose app.json sits at its own root reported "N source(s) failed to parse"
// and "not a git repository". These tests pin two things at once: audit mode
// no longer false-fails on a correct foreign project, and it still catches a
// genuine MS013 mismatch or MS029 violation, so "zero false positives" is not
// bought by rubber-stamping.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const AUDIT = join(REPO_ROOT, "scripts", "surface-audit.mjs");
const APP_GROUP_GATE = join(REPO_ROOT, "scripts", "check-app-group-identity.mjs");
const IOS_GATE = join(REPO_ROOT, "scripts", "check-ios-gitignore.mjs");

const NODE_ARGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
];

function appJson({ group, deploymentTarget = "17.4" } = {}) {
  return JSON.stringify(
    {
      expo: {
        name: "Foreign App",
        slug: "foreign-app",
        ios: {
          bundleIdentifier: "com.acme.foreign",
          deploymentTarget,
          ...(group
            ? {
                entitlements: {
                  "com.apple.security.application-groups": [group],
                },
              }
            : {}),
        },
      },
    },
    null,
    2,
  );
}

function widgetEntitlements(group) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${group}</string>
  </array>
</dict>
</plist>
`;
}

// Build a foreign Expo project under a fresh temp dir.
//   layout      "root"     app.json at the project root
//               "monorepo" app.json at apps/<name>/app.json
//   group       App Group declared in app.json (omit for none)
//   widgetGroup writes targets/<...>/widget/generated.entitlements with this
//               group, relative to the app directory (to exercise cross-source
//               checks in audit mode)
//   git         git-init the project and commit
//   gitignore   contents of the project-root .gitignore
//   withContractDep  add @mobile-surfaces/surface-contracts to dependencies
function makeProject({
  layout = "root",
  group = "group.com.acme.foreign",
  widgetGroup = null,
  git = true,
  gitignore = "/ios\nnode_modules\n",
  withContractDep = true,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ms-surface-audit-"));
  const appDir =
    layout === "monorepo" ? join(dir, "apps", "foreignmobile") : dir;
  mkdirSync(appDir, { recursive: true });

  writeFileSync(join(appDir, "app.json"), appJson({ group }));
  writeFileSync(
    join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "foreign-app",
        dependencies: {
          expo: "~55.0.0",
          ...(withContractDep
            ? { "@mobile-surfaces/surface-contracts": "^9.0.0" }
            : {}),
        },
      },
      null,
      2,
    ),
  );
  if (widgetGroup) {
    const entDir = join(appDir, "targets", "widget");
    mkdirSync(entDir, { recursive: true });
    writeFileSync(
      join(entDir, "generated.entitlements"),
      widgetEntitlements(widgetGroup),
    );
  }
  if (gitignore) writeFileSync(join(dir, ".gitignore"), gitignore);
  if (git) {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    spawnSync("git", ["config", "user.name", "test"], { cwd: dir });
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync("git", ["commit", "-q", "-m", "init", "--allow-empty"], {
      cwd: dir,
    });
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runAudit(root) {
  const r = spawnSync(process.execPath, [...NODE_ARGS, AUDIT, "--root", root, "--json"], {
    encoding: "utf8",
  });
  return { exitCode: r.status, json: JSON.parse(r.stdout) };
}

function runGate(script, root) {
  const r = spawnSync(
    process.execPath,
    [...NODE_ARGS, script, "--root", root, "--mode", "audit", "--json"],
    { encoding: "utf8" },
  );
  return { exitCode: r.status, report: JSON.parse(r.stdout) };
}

// Count fail-status checks inside one gate's report in the audit JSON.
function gateFailCount(auditJson, gateId) {
  const gate = auditJson.checks.find((c) => c.id === gateId);
  assert.ok(gate, `gate ${gateId} not present in audit output`);
  assert.ok(gate.report, `gate ${gateId} produced no parseable report`);
  return gate.report.checks.filter((c) => c.status === "fail").length;
}

test("surface:audit produces zero false positives on a correct foreign project", () => {
  const ws = makeProject({ layout: "root" });
  try {
    const { json } = runAudit(ws.dir);
    // The two gates that hard-coded apps/mobile/ before this fix, plus the
    // app-config probe, must all be clean against a correctly adopted
    // foreign project. (The doctor gate depends on local toolchain and is
    // intentionally not asserted here.)
    assert.equal(gateFailCount(json, "check-app-group-identity"), 0);
    assert.equal(gateFailCount(json, "check-ios-gitignore"), 0);
    assert.equal(gateFailCount(json, "probe-app-config"), 0);
  } finally {
    ws.cleanup();
  }
});

test("check-app-group-identity locates app.json in a foreign monorepo layout", () => {
  const ws = makeProject({ layout: "monorepo" });
  try {
    const { exitCode, report } = runGate(APP_GROUP_GATE, ws.dir);
    assert.equal(exitCode, 0, JSON.stringify(report));
    assert.equal(report.status, "ok");
  } finally {
    ws.cleanup();
  }
});

test("check-app-group-identity treats a foreign project with no App Group as not applicable", () => {
  const ws = makeProject({ group: null });
  try {
    const { exitCode, report } = runGate(APP_GROUP_GATE, ws.dir);
    assert.equal(exitCode, 0, JSON.stringify(report));
    assert.equal(report.status, "ok");
    assert.match(JSON.stringify(report), /not applicable/);
  } finally {
    ws.cleanup();
  }
});

test("check-app-group-identity still catches a real cross-source App Group mismatch in audit mode", () => {
  // app.json declares one group; a sibling widget entitlements file declares
  // another. Audit mode must still fail this, or "zero false positives" would
  // just mean the gate never fires.
  const ws = makeProject({
    group: "group.com.acme.foreign",
    widgetGroup: "group.com.acme.WRONG",
  });
  try {
    const { exitCode, report } = runGate(APP_GROUP_GATE, ws.dir);
    assert.notEqual(exitCode, 0);
    assert.match(JSON.stringify(report), /MS013/);
    assert.match(JSON.stringify(report), /WRONG/);
  } finally {
    ws.cleanup();
  }
});

test("check-ios-gitignore treats a non-git foreign project as not applicable", () => {
  const ws = makeProject({ git: false });
  try {
    const { exitCode, report } = runGate(IOS_GATE, ws.dir);
    assert.equal(exitCode, 0, JSON.stringify(report));
    assert.equal(report.status, "ok");
    assert.match(JSON.stringify(report), /not a git working tree/);
  } finally {
    ws.cleanup();
  }
});

test("check-ios-gitignore still flags a foreign project that does not gitignore ios/", () => {
  const ws = makeProject({ gitignore: "node_modules\n" });
  try {
    const { exitCode, report } = runGate(IOS_GATE, ws.dir);
    assert.notEqual(exitCode, 0);
    assert.match(JSON.stringify(report), /MS029/);
    assert.match(JSON.stringify(report), /not gitignored/);
  } finally {
    ws.cleanup();
  }
});

test("audit-mode gates fail cleanly when --root is not an Expo project", () => {
  const dir = mkdtempSync(join(tmpdir(), "ms-surface-audit-empty-"));
  try {
    for (const script of [APP_GROUP_GATE, IOS_GATE]) {
      const { exitCode, report } = runGate(script, dir);
      assert.notEqual(exitCode, 0, `${script} should fail on a non-Expo dir`);
      assert.match(JSON.stringify(report), /No Expo app config found/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
