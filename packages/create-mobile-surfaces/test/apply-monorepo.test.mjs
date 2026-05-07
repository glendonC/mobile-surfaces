import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  appendPnpmGlobs,
  applyIdentityRewrites,
  buildIdentitySubstitutions,
  DEFAULT_IDENTITY,
  mergeWorkspaceGlobs,
  rewriteAppsMobileWorkspaceDeps,
} from "../src/apply-monorepo.mjs";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-monorepo-"));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
});

function write(rel, contents) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

describe("buildIdentitySubstitutions", () => {
  it("orders longer/more specific substitutions first to avoid clobber", () => {
    const newId = {
      name: "Foo App",
      scheme: "fooapp",
      bundleId: "com.acme.foo",
      widgetTarget: "FooAppWidget",
      swiftPrefix: "FooApp",
      slug: "foo-app",
      appPackageName: "foo-app-app",
    };
    const subs = buildIdentitySubstitutions(newId);
    // bundleId before scheme; widgetTarget before swiftPrefix.
    const literalFroms = subs
      .filter((s) => s.kind === "literal")
      .map((s) => s.from);
    assert.ok(
      literalFroms.indexOf(DEFAULT_IDENTITY.bundleId) <
        literalFroms.indexOf(DEFAULT_IDENTITY.scheme),
      "bundleId must come before scheme",
    );
    assert.ok(
      literalFroms.indexOf(DEFAULT_IDENTITY.widgetTarget) <
        literalFroms.indexOf(DEFAULT_IDENTITY.swiftPrefix),
      "widgetTarget must come before swiftPrefix",
    );
  });

  it("uses a regex with a negative lookbehind for the slug so @mobile-surfaces/* is preserved", () => {
    const newId = {
      ...DEFAULT_IDENTITY,
      name: "Foo",
      slug: "foo",
      swiftPrefix: "Foo",
      widgetTarget: "FooWidget",
      appPackageName: "foo-app",
      scheme: "foo",
      bundleId: "com.acme.foo",
    };
    const subs = buildIdentitySubstitutions(newId);
    const sample =
      "import @mobile-surfaces/surface-contracts; mobile-surfaces is here";
    const out = subs.reduce((acc, sub) => {
      if (sub.kind === "regex") return acc.replace(sub.from, sub.to);
      return acc.split(sub.from).join(sub.to);
    }, sample);
    assert.ok(
      out.includes("@mobile-surfaces/surface-contracts"),
      "the npm scope must not be rewritten",
    );
    assert.ok(
      out.includes("foo is here"),
      "free-standing slug occurrences should still be rewritten",
    );
  });
});

describe("applyIdentityRewrites", () => {
  it("rewrites text files under rootDir, leaving non-text files untouched", () => {
    write("src/foo.swift", "import MobileSurfaces\nlet x = MobileSurfacesWidget\n");
    write("README.md", "# mobile-surfaces\nscheme: mobilesurfaces");
    write("assets/icon.png", "binary-data-pretend");

    const newId = {
      ...DEFAULT_IDENTITY,
      name: "Foo App",
      scheme: "foo",
      bundleId: "com.acme.foo",
      widgetTarget: "FooWidget",
      swiftPrefix: "Foo",
      slug: "foo-app",
      appPackageName: "foo-app-app",
    };
    const subs = buildIdentitySubstitutions(newId);
    const touched = applyIdentityRewrites({ rootDir: tmp, substitutions: subs });
    assert.ok(touched >= 2);

    const swift = fs.readFileSync(path.join(tmp, "src/foo.swift"), "utf8");
    assert.ok(swift.includes("import Foo\n"), "swiftPrefix should be applied");
    assert.ok(swift.includes("FooWidget"), "widgetTarget should be applied");
    assert.ok(!swift.includes("MobileSurfaces"), "no leftover bundled prefix");

    const md = fs.readFileSync(path.join(tmp, "README.md"), "utf8");
    assert.ok(md.includes("foo-app"), "slug should be applied");
    assert.ok(md.includes("foo"), "scheme should be applied");

    const png = fs.readFileSync(path.join(tmp, "assets/icon.png"), "utf8");
    assert.equal(png, "binary-data-pretend", "binary files should not be rewritten");
  });

  it("skips ios/, node_modules, .git", () => {
    write("ios/Foo.swift", "MobileSurfaces");
    write("node_modules/foo/index.js", "MobileSurfaces");
    write(".git/HEAD", "MobileSurfaces");
    write("src/keep.ts", "MobileSurfaces");

    const newId = { ...DEFAULT_IDENTITY, name: "X", swiftPrefix: "X" };
    const subs = buildIdentitySubstitutions(newId);
    applyIdentityRewrites({ rootDir: tmp, substitutions: subs });

    assert.ok(
      fs.readFileSync(path.join(tmp, "ios/Foo.swift"), "utf8").includes("MobileSurfaces"),
      "ios/ should be skipped",
    );
    assert.ok(
      !fs.readFileSync(path.join(tmp, "src/keep.ts"), "utf8").includes("MobileSurfaces"),
      "src/ should be rewritten",
    );
  });
});

describe("rewriteAppsMobileWorkspaceDeps", () => {
  it("replaces workspace:* refs to @mobile-surfaces/* with manifest npm versions", () => {
    write(
      "package.json",
      JSON.stringify({
        name: "mobile-surfaces-app",
        dependencies: {
          "@mobile-surfaces/surface-contracts": "workspace:*",
          "@mobile-surfaces/live-activity": "file:../../packages/live-activity",
          expo: "~55.0.18",
        },
        devDependencies: {
          "@mobile-surfaces/design-tokens": "workspace:*",
        },
      }),
    );

    const manifest = {
      addPackages: [
        { name: "@mobile-surfaces/surface-contracts", version: "^1.3.0" },
        { name: "@mobile-surfaces/design-tokens", version: "^1.3.0" },
        { name: "@mobile-surfaces/live-activity", version: "^1.3.0" },
      ],
    };
    const result = rewriteAppsMobileWorkspaceDeps({ appsMobileRoot: tmp, manifest });
    assert.equal(result.rewrote, 3);

    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
    assert.equal(pkg.dependencies["@mobile-surfaces/surface-contracts"], "^1.3.0");
    assert.equal(pkg.dependencies["@mobile-surfaces/live-activity"], "^1.3.0");
    assert.equal(pkg.dependencies.expo, "~55.0.18", "non-mobile-surfaces deps untouched");
    assert.equal(pkg.devDependencies["@mobile-surfaces/design-tokens"], "^1.3.0");
  });

  it("leaves a workspace ref unchanged when manifest has no version (still flagged as workspace)", () => {
    write(
      "package.json",
      JSON.stringify({
        dependencies: { "@mobile-surfaces/push": "workspace:*" },
      }),
    );
    const manifest = {
      addPackages: [{ name: "@mobile-surfaces/push", version: "workspace", workspace: true }],
    };
    const result = rewriteAppsMobileWorkspaceDeps({ appsMobileRoot: tmp, manifest });
    assert.equal(result.rewrote, 0);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
    assert.equal(pkg.dependencies["@mobile-surfaces/push"], "workspace:*");
  });
});

describe("appendPnpmGlobs", () => {
  it("appends to an existing packages: block, preserving comments", () => {
    const yaml = "# top comment\npackages:\n  - 'apps/api'\n  - 'lib/*'\n";
    const out = appendPnpmGlobs(yaml, ["apps/*"]);
    assert.match(out, /# top comment/);
    assert.match(out, /- 'apps\/api'/);
    assert.match(out, /- 'lib\/\*'/);
    assert.match(out, /- "apps\/\*"/);
  });

  it("creates a packages: block when none exists", () => {
    const out = appendPnpmGlobs("# only a comment\n", ["apps/*"]);
    assert.match(out, /^# only a comment/);
    assert.match(out, /packages:\n  - "apps\/\*"/);
  });
});

describe("mergeWorkspaceGlobs", () => {
  it("returns no-op when apps/* already in pnpm-workspace.yaml", () => {
    const yamlPath = path.join(tmp, "pnpm-workspace.yaml");
    fs.writeFileSync(yamlPath, "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    const result = mergeWorkspaceGlobs({
      workspace: { kind: "pnpm-workspace", path: yamlPath, globs: ["apps/*", "packages/*"] },
    });
    assert.equal(result.changed, false);
  });

  it("appends missing globs to pnpm-workspace.yaml", () => {
    const yamlPath = path.join(tmp, "pnpm-workspace.yaml");
    fs.writeFileSync(yamlPath, "packages:\n  - 'lib/*'\n");
    const result = mergeWorkspaceGlobs({
      workspace: { kind: "pnpm-workspace", path: yamlPath, globs: ["lib/*"] },
    });
    assert.equal(result.changed, true);
    assert.deepEqual(result.addedGlobs, ["apps/*"]);
    const updated = fs.readFileSync(yamlPath, "utf8");
    assert.match(updated, /- 'lib\/\*'/);
    assert.match(updated, /- "apps\/\*"/);
  });

  it("appends to package.json workspaces array", () => {
    const pkgPath = path.join(tmp, "package.json");
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({ name: "host", workspaces: ["lib/*"] }, null, 2),
    );
    const result = mergeWorkspaceGlobs({
      workspace: {
        kind: "package-json",
        path: null,
        globs: ["lib/*"],
        packageJsonPath: pkgPath,
      },
    });
    assert.equal(result.changed, true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert.deepEqual(pkg.workspaces, ["lib/*", "apps/*"]);
  });

  it("appends to yarn workspaces.packages object form", () => {
    const pkgPath = path.join(tmp, "package.json");
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        { name: "host", workspaces: { packages: ["lib/*"], nohoist: [] } },
        null,
        2,
      ),
    );
    const result = mergeWorkspaceGlobs({
      workspace: {
        kind: "package-json",
        path: null,
        globs: ["lib/*"],
        packageJsonPath: pkgPath,
      },
    });
    assert.equal(result.changed, true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert.deepEqual(pkg.workspaces.packages, ["lib/*", "apps/*"]);
    assert.deepEqual(pkg.workspaces.nohoist, []);
  });
});
