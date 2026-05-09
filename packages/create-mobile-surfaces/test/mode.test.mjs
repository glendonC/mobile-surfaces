import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { detectMode, MODE, parsePnpmWorkspaceGlobs, renderRefuse } from "../src/mode.mjs";

let tmp;
let savedUserAgent;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-mode-"));
  // Most tests look at filesystem signals; clear the user-agent so the
  // package-manager detection's first-priority signal is suppressed for
  // tests that aren't explicitly about it.
  savedUserAgent = process.env.npm_config_user_agent;
  delete process.env.npm_config_user_agent;
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  if (savedUserAgent !== undefined) {
    process.env.npm_config_user_agent = savedUserAgent;
  }
});

function write(rel, contents) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

describe("detectMode — explicit positional name", () => {
  it("treats a positional as a sibling project regardless of cwd state", () => {
    write("package.json", JSON.stringify({ name: "host", dependencies: { expo: "~54.0.0" } }));
    const mode = detectMode({ cwd: tmp, targetName: "new-app" });
    assert.equal(mode.kind, MODE.GREENFIELD);
    assert.equal(mode.target, path.join(tmp, "new-app"));
  });
});

describe("detectMode — empty cwd", () => {
  it("returns greenfield with no target (CLI will prompt for name)", () => {
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.GREENFIELD);
    assert.equal(mode.target, null);
  });

  it("treats hidden-only entries as empty (so cd into a fresh dir with .git works)", () => {
    fs.mkdirSync(path.join(tmp, ".git"));
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.GREENFIELD);
  });
});

describe("detectMode — non-Expo refusals", () => {
  it("flags missing package.json with a tailored reason", () => {
    write("random.txt", "hello");
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_NON_EXPO);
    assert.equal(mode.evidence.reason, "no-package-json");
  });

  it("flags invalid package.json", () => {
    write("package.json", "{ not valid json");
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_NON_EXPO);
    assert.equal(mode.evidence.reason, "invalid-package-json");
  });

  it("flags a package.json that doesn't depend on expo", () => {
    write("package.json", JSON.stringify({ name: "rn-app", dependencies: { "react-native": "0.81.0" } }));
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_NON_EXPO);
    assert.equal(mode.evidence.reason, "no-expo-dep");
    assert.equal(mode.evidence.packageName, "rn-app");
  });

  it("flags a workspace whose apps/mobile/ already exists", () => {
    // A pnpm workspace with apps/mobile/ already on disk means the user has
    // either already scaffolded Mobile Surfaces or is sitting at the wrong
    // root. Either way, the right next step is `cd apps/mobile && run again`.
    write("package.json", JSON.stringify({ name: "host" }));
    write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    fs.mkdirSync(path.join(tmp, "apps", "mobile"), { recursive: true });
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_NON_EXPO);
    assert.equal(mode.evidence.reason, "apps-mobile-exists");
  });
});

describe("detectMode — existing monorepo, no Expo", () => {
  it("detects pnpm workspace + no expo + no apps/mobile/", () => {
    write("package.json", JSON.stringify({ name: "host", devDependencies: { typescript: "^5" } }));
    write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    write("apps/api/package.json", JSON.stringify({ name: "api" }));
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_MONOREPO_NO_EXPO);
    assert.equal(mode.evidence.workspaceKind, "pnpm-workspace");
    assert.deepEqual(mode.evidence.workspaceGlobs, ["apps/*", "packages/*"]);
    assert.equal(mode.evidence.packageName, "host");
  });

  it("detects npm/yarn workspace via package.json `workspaces` array", () => {
    write(
      "package.json",
      JSON.stringify({ name: "host", workspaces: ["apps/*", "lib/*"] }),
    );
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_MONOREPO_NO_EXPO);
    assert.equal(mode.evidence.workspaceKind, "package-json");
    assert.deepEqual(mode.evidence.workspaceGlobs, ["apps/*", "lib/*"]);
  });

  it("detects yarn workspaces.packages object form", () => {
    write(
      "package.json",
      JSON.stringify({
        name: "host",
        workspaces: { packages: ["packages/*"], nohoist: [] },
      }),
    );
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_MONOREPO_NO_EXPO);
    assert.deepEqual(mode.evidence.workspaceGlobs, ["packages/*"]);
  });

  it("does not match a workspace that has Expo (that's existing-expo)", () => {
    write(
      "package.json",
      JSON.stringify({ name: "host", dependencies: { expo: "~54.0.0" } }),
    );
    write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_EXPO);
  });
});

describe("renderRefuse", () => {
  // Capture stdout so we can assert on what the user actually sees without
  // letting the test polluting the test runner's output.
  function captureStdout(fn) {
    const original = process.stdout.write.bind(process.stdout);
    let captured = "";
    process.stdout.write = (chunk) => {
      captured += chunk;
      return true;
    };
    try {
      fn();
    } finally {
      process.stdout.write = original;
    }
    return captured;
  }

  it("renders the no-package-json copy", () => {
    const output = captureStdout(() =>
      renderRefuse({ evidence: { reason: "no-package-json", cwd: "/foo" } }),
    );
    assert.match(output, /Can't add Mobile Surfaces here/);
    assert.match(output, /package\.json/);
  });

  it("renders the invalid-package-json copy with the cwd", () => {
    const output = captureStdout(() =>
      renderRefuse({
        evidence: { reason: "invalid-package-json", cwd: "/some/path" },
      }),
    );
    assert.match(output, /\/some\/path/);
  });

  it("renders the no-expo-dep copy with the package name", () => {
    const output = captureStdout(() =>
      renderRefuse({
        evidence: { reason: "no-expo-dep", packageName: "my-app" },
      }),
    );
    assert.match(output, /my-app/);
  });

  it("renders the apps-mobile-exists copy with the package name", () => {
    const output = captureStdout(() =>
      renderRefuse({
        evidence: { reason: "apps-mobile-exists", packageName: "host-monorepo" },
      }),
    );
    assert.match(output, /host-monorepo/);
  });

  it("falls back to the default copy for an unknown reason", () => {
    // A new refuse reason added to mode.mjs without updating the switch
    // statement would land here. The fallback is the generic "no-package-json"
    // copy, which is at least never wrong shape-wise. This test pins the
    // behavior so a future refactor can't silently change it.
    const output = captureStdout(() =>
      renderRefuse({ evidence: { reason: "newly-invented-reason" } }),
    );
    assert.match(output, /Can't add Mobile Surfaces here/);
  });
});

describe("parsePnpmWorkspaceGlobs", () => {
  it("reads a list of single-quoted entries", () => {
    const yaml = "packages:\n  - 'apps/*'\n  - 'packages/*'\n";
    assert.deepEqual(parsePnpmWorkspaceGlobs(yaml), ["apps/*", "packages/*"]);
  });

  it("reads double-quoted and unquoted entries", () => {
    const yaml = "packages:\n  - \"apps/*\"\n  - packages/*\n";
    assert.deepEqual(parsePnpmWorkspaceGlobs(yaml), ["apps/*", "packages/*"]);
  });

  it("returns empty when no packages key", () => {
    assert.deepEqual(parsePnpmWorkspaceGlobs("# nothing\n"), []);
  });

  it("ignores comments", () => {
    const yaml = "# header\npackages:\n  - 'apps/*' # comment here\n";
    assert.deepEqual(parsePnpmWorkspaceGlobs(yaml), ["apps/*"]);
  });
});

describe("detectMode — existing Expo", () => {
  it("detects expo from dependencies", () => {
    write("package.json", JSON.stringify({ name: "host", dependencies: { expo: "~54.0.0" } }));
    write("app.json", JSON.stringify({
      expo: {
        name: "Host App",
        ios: { bundleIdentifier: "com.acme.host", deploymentTarget: "17.2" },
        plugins: ["expo-dev-client"],
      },
    }));
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_EXPO);
    assert.equal(mode.evidence.expoVersion, "~54.0.0");
    assert.equal(mode.evidence.config.kind, "json");
    assert.equal(mode.evidence.config.bundleId, "com.acme.host");
    assert.deepEqual(mode.evidence.pluginsPresent, ["expo-dev-client"]);
  });

  it("detects expo from devDependencies", () => {
    write("package.json", JSON.stringify({ name: "host", devDependencies: { expo: "~54.0.0" } }));
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_EXPO);
  });

  it("flags app.config.ts as a kind that needs manual patching", () => {
    write("package.json", JSON.stringify({ dependencies: { expo: "~54.0.0" } }));
    write("app.config.ts", "export default { name: 'foo' }");
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.kind, MODE.EXISTING_EXPO);
    assert.equal(mode.evidence.config.kind, "ts");
  });

  it("flags app.config.js the same way", () => {
    write("package.json", JSON.stringify({ dependencies: { expo: "~54.0.0" } }));
    write("app.config.js", "module.exports = { name: 'foo' };");
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.evidence.config.kind, "js");
  });

  it("prefers app.json over app.config.js when both exist", () => {
    write("package.json", JSON.stringify({ dependencies: { expo: "~54.0.0" } }));
    write("app.json", JSON.stringify({ expo: { name: "x" } }));
    write("app.config.js", "module.exports = {}");
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.evidence.config.kind, "json");
  });

  it("normalizes plugin entries to a flat name list (handles both string and array forms)", () => {
    write("package.json", JSON.stringify({ dependencies: { expo: "~54.0.0" } }));
    write("app.json", JSON.stringify({
      expo: {
        plugins: [
          "expo-dev-client",
          ["expo-build-properties", { ios: { deploymentTarget: "17.2" } }],
        ],
      },
    }));
    const mode = detectMode({ cwd: tmp });
    assert.deepEqual(mode.evidence.pluginsPresent, ["expo-dev-client", "expo-build-properties"]);
  });

  it("detects the package manager from a lockfile in cwd", () => {
    write("package.json", JSON.stringify({ dependencies: { expo: "~54.0.0" } }));
    write("yarn.lock", "");
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.evidence.packageManager, "yarn");
  });

  it("walks up parent dirs to find a lockfile (monorepo case)", () => {
    write("package.json", JSON.stringify({ dependencies: { expo: "~54.0.0" } }));
    // Use a sibling subdir with the lockfile in tmp's parent — tests the
    // upward walk without leaking files into /tmp at large.
    const subdir = path.join(tmp, "apps", "mobile");
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
    fs.writeFileSync(path.join(subdir, "package.json"), JSON.stringify({ dependencies: { expo: "~54.0.0" } }));
    const mode = detectMode({ cwd: subdir });
    assert.equal(mode.evidence.packageManager, "pnpm");
  });

  it("prefers npm_config_user_agent over the lockfile signal", () => {
    write("package.json", JSON.stringify({ dependencies: { expo: "~54.0.0" } }));
    write("yarn.lock", "");
    process.env.npm_config_user_agent = "bun/1.1.0 npm/? node/v20.11 darwin arm64";
    const mode = detectMode({ cwd: tmp });
    assert.equal(mode.evidence.packageManager, "bun");
  });
});
