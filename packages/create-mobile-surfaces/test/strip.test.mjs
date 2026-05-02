import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  applyStripGreenfield,
  applyStripWidgetDir,
  formatSurfaceSummary,
  processFileContent,
} from "../src/strip.mjs";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-strip-"));
});
afterEach(() => {
  if (tmp && fs.existsSync(tmp)) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const ALL_ON = { homeWidget: true, controlWidget: true };
const ALL_OFF = { homeWidget: false, controlWidget: false };
const HOME_OFF = { homeWidget: false, controlWidget: true };
const CONTROL_OFF = { homeWidget: true, controlWidget: false };

describe("processFileContent — single-id markers", () => {
  it("strips home-widget block content when homeWidget is off", () => {
    const src = [
      "const a = 1;",
      "// SURFACE-BEGIN: home-widget",
      "const b = 2;",
      "// SURFACE-END: home-widget",
      "const c = 3;",
    ].join("\n");
    assert.equal(
      processFileContent(src, HOME_OFF),
      ["const a = 1;", "const c = 3;"].join("\n"),
    );
  });

  it("keeps content but removes markers when homeWidget is on", () => {
    const src = [
      "const a = 1;",
      "// SURFACE-BEGIN: home-widget",
      "const b = 2;",
      "// SURFACE-END: home-widget",
      "const c = 3;",
    ].join("\n");
    assert.equal(
      processFileContent(src, ALL_ON),
      ["const a = 1;", "const b = 2;", "const c = 3;"].join("\n"),
    );
  });

  it("supports JSX comment markers", () => {
    const src = [
      "<View>",
      "  {/* SURFACE-BEGIN: control-widget */}",
      "  <Toggle />",
      "  {/* SURFACE-END: control-widget */}",
      "</View>",
    ].join("\n");
    assert.equal(
      processFileContent(src, CONTROL_OFF),
      ["<View>", "</View>"].join("\n"),
    );
  });
});

describe("processFileContent — multi-id markers", () => {
  it("keeps content when at least one cited surface is selected", () => {
    const src = [
      "// SURFACE-BEGIN: home-widget control-widget",
      "const shared = true;",
      "// SURFACE-END: home-widget control-widget",
    ].join("\n");
    assert.equal(processFileContent(src, HOME_OFF), "const shared = true;");
    assert.equal(processFileContent(src, CONTROL_OFF), "const shared = true;");
  });

  it("strips content only when every cited surface is deselected", () => {
    const src = [
      "// SURFACE-BEGIN: home-widget control-widget",
      "const shared = true;",
      "// SURFACE-END: home-widget control-widget",
    ].join("\n");
    assert.equal(processFileContent(src, ALL_OFF), "");
  });

  it("treats end-marker id order independently of begin", () => {
    const src = [
      "// SURFACE-BEGIN: home-widget control-widget",
      "x",
      "// SURFACE-END: control-widget home-widget",
    ].join("\n");
    assert.equal(processFileContent(src, ALL_ON), "x");
  });
});

describe("processFileContent — nested markers", () => {
  it("handles destructured imports with per-name markers", () => {
    const src = [
      "import {",
      "  // SURFACE-BEGIN: home-widget",
      "  refreshWidget,",
      "  // SURFACE-END: home-widget",
      "  // SURFACE-BEGIN: control-widget",
      "  toggleControl,",
      "  // SURFACE-END: control-widget",
      "} from 'x';",
    ].join("\n");
    assert.equal(
      processFileContent(src, HOME_OFF),
      ["import {", "  toggleControl,", "} from 'x';"].join("\n"),
    );
  });
});

describe("processFileContent — error cases", () => {
  it("throws on an unknown surface id rather than silently dropping code", () => {
    assert.throws(
      () =>
        processFileContent(
          "// SURFACE-BEGIN: bogus\nx\n// SURFACE-END: bogus",
          ALL_ON,
        ),
      /Unknown SURFACE id "bogus"/,
    );
  });

  it("throws on an unmatched begin", () => {
    assert.throws(
      () =>
        processFileContent("// SURFACE-BEGIN: home-widget\nx", ALL_OFF),
      /no matching END/,
    );
  });

  it("throws on an unmatched end", () => {
    assert.throws(
      () => processFileContent("// SURFACE-END: home-widget", ALL_ON),
      /no matching BEGIN/,
    );
  });

  it("throws when begin and end ids don't match", () => {
    assert.throws(
      () =>
        processFileContent(
          "// SURFACE-BEGIN: home-widget\nx\n// SURFACE-END: control-widget",
          ALL_ON,
        ),
      /does not match/,
    );
  });
});

describe("processFileContent — fast path", () => {
  it("returns the content unchanged when there are no markers", () => {
    const src = "const x = 1;\nconst y = 2;\n";
    assert.equal(processFileContent(src, ALL_OFF), src);
  });
});

describe("applyStripWidgetDir — file-system pass", () => {
  function seedWidget(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "MobileSurfacesActivityAttributes.swift"),
      "// no markers here\n",
    );
    fs.writeFileSync(
      path.join(dir, "MobileSurfacesHomeWidget.swift"),
      "// home widget\n",
    );
    fs.writeFileSync(
      path.join(dir, "MobileSurfacesControlWidget.swift"),
      "// control widget\n",
    );
    fs.writeFileSync(
      path.join(dir, "MobileSurfacesWidgetBundle.swift"),
      [
        "import WidgetKit",
        "@main",
        "struct Bundle: WidgetBundle {",
        "  var body: some Widget {",
        "    MobileSurfacesLiveActivity()",
        "    // SURFACE-BEGIN: home-widget",
        "    MobileSurfacesHomeWidget()",
        "    // SURFACE-END: home-widget",
        "    // SURFACE-BEGIN: control-widget",
        "    if #available(iOS 18.0, *) {",
        "      MobileSurfacesControlWidget()",
        "    }",
        "    // SURFACE-END: control-widget",
        "  }",
        "}",
      ].join("\n"),
    );
  }

  it("deletes deselected widget swift files and strips bundle markers", () => {
    const widgetDir = path.join(tmp, "widget");
    seedWidget(widgetDir);

    const summary = applyStripWidgetDir({ widgetDir, surfaces: HOME_OFF });

    assert.equal(
      fs.existsSync(path.join(widgetDir, "MobileSurfacesHomeWidget.swift")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(widgetDir, "MobileSurfacesControlWidget.swift")),
      true,
    );
    const bundle = fs.readFileSync(
      path.join(widgetDir, "MobileSurfacesWidgetBundle.swift"),
      "utf8",
    );
    assert.equal(/SURFACE-(BEGIN|END)/.test(bundle), false);
    assert.equal(bundle.includes("MobileSurfacesHomeWidget()"), false);
    assert.equal(bundle.includes("MobileSurfacesControlWidget()"), true);
    assert.deepEqual(summary.filesDeleted, ["MobileSurfacesHomeWidget.swift"]);
  });

  it("keeps both widget files when both surfaces are selected, but still removes markers", () => {
    const widgetDir = path.join(tmp, "widget");
    seedWidget(widgetDir);

    applyStripWidgetDir({ widgetDir, surfaces: ALL_ON });

    assert.equal(
      fs.existsSync(path.join(widgetDir, "MobileSurfacesHomeWidget.swift")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(widgetDir, "MobileSurfacesControlWidget.swift")),
      true,
    );
    const bundle = fs.readFileSync(
      path.join(widgetDir, "MobileSurfacesWidgetBundle.swift"),
      "utf8",
    );
    assert.equal(/SURFACE-(BEGIN|END)/.test(bundle), false);
    assert.equal(bundle.includes("MobileSurfacesHomeWidget()"), true);
    assert.equal(bundle.includes("MobileSurfacesControlWidget()"), true);
  });
});

describe("applyStripGreenfield — fixture index pruning", () => {
  function seedFixtureDir(dir) {
    fs.mkdirSync(path.join(dir, "data", "surface-fixtures"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "data/surface-fixtures/queued.json"),
      JSON.stringify({ id: "queued" }),
    );
    fs.writeFileSync(
      path.join(dir, "data/surface-fixtures/widget-dashboard.json"),
      JSON.stringify({ id: "widget-dashboard" }),
    );
    fs.writeFileSync(
      path.join(dir, "data/surface-fixtures/control-toggle.json"),
      JSON.stringify({ id: "control-toggle" }),
    );
    fs.writeFileSync(
      path.join(dir, "data/surface-fixtures/index.json"),
      JSON.stringify(
        ["./queued.json", "./widget-dashboard.json", "./control-toggle.json"],
        null,
        2,
      ) + "\n",
    );
  }

  it("removes the deselected fixture entries from index.json", () => {
    seedFixtureDir(tmp);
    // No scripts/generate-surface-fixtures.mjs in tmp — the regen step is
    // skipped by design when the generator is missing, so the test focuses
    // on the index pruning itself.
    const summary = applyStripGreenfield({ rootDir: tmp, surfaces: HOME_OFF });

    const index = JSON.parse(
      fs.readFileSync(
        path.join(tmp, "data/surface-fixtures/index.json"),
        "utf8",
      ),
    );
    assert.deepEqual(index, ["./queued.json", "./control-toggle.json"]);
    assert.equal(summary.indexUpdated, true);
    assert.equal(
      fs.existsSync(path.join(tmp, "data/surface-fixtures/widget-dashboard.json")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(tmp, "data/surface-fixtures/control-toggle.json")),
      true,
    );
  });

  it("leaves index.json alone when both surfaces are selected", () => {
    seedFixtureDir(tmp);
    const summary = applyStripGreenfield({ rootDir: tmp, surfaces: ALL_ON });

    const index = JSON.parse(
      fs.readFileSync(
        path.join(tmp, "data/surface-fixtures/index.json"),
        "utf8",
      ),
    );
    assert.deepEqual(index, [
      "./queued.json",
      "./widget-dashboard.json",
      "./control-toggle.json",
    ]);
    assert.equal(summary.indexUpdated, false);
    assert.equal(summary.fixturesRegenerated, false);
  });
});

describe("applyStripGreenfield — integration against real source files", () => {
  // Seed a tmp tree with the actual harness, widget bundle, and a small
  // fixture set so we exercise the same files a real scaffold extracts.
  // This catches regressions where a marker grammar change works on
  // synthetic fixtures but breaks on the real source layout.
  function repoRoot() {
    return path.resolve(import.meta.dirname, "..", "..", "..");
  }

  function copyFromRepo(relPath, destDir) {
    const src = path.join(repoRoot(), relPath);
    const dst = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  function seedRealisticTree(dir) {
    copyFromRepo(
      "apps/mobile/src/screens/LiveActivityHarness.tsx",
      dir,
    );
    copyFromRepo(
      "apps/mobile/targets/widget/MobileSurfacesWidgetBundle.swift",
      dir,
    );
    copyFromRepo(
      "apps/mobile/targets/widget/MobileSurfacesHomeWidget.swift",
      dir,
    );
    copyFromRepo(
      "apps/mobile/targets/widget/MobileSurfacesControlWidget.swift",
      dir,
    );
    copyFromRepo("data/surface-fixtures/index.json", dir);
    copyFromRepo("data/surface-fixtures/queued.json", dir);
    copyFromRepo("data/surface-fixtures/widget-dashboard.json", dir);
    copyFromRepo("data/surface-fixtures/control-toggle.json", dir);
  }

  function harnessAt(dir) {
    return fs.readFileSync(
      path.join(dir, "apps/mobile/src/screens/LiveActivityHarness.tsx"),
      "utf8",
    );
  }

  function bundleAt(dir) {
    return fs.readFileSync(
      path.join(dir, "apps/mobile/targets/widget/MobileSurfacesWidgetBundle.swift"),
      "utf8",
    );
  }

  function indexAt(dir) {
    return JSON.parse(
      fs.readFileSync(path.join(dir, "data/surface-fixtures/index.json"), "utf8"),
    );
  }

  it("all-on: removes every SURFACE marker but keeps every section", () => {
    seedRealisticTree(tmp);
    applyStripGreenfield({ rootDir: tmp, surfaces: ALL_ON });

    const harness = harnessAt(tmp);
    const bundle = bundleAt(tmp);

    assert.equal(/SURFACE-(BEGIN|END)/.test(harness), false);
    assert.equal(/SURFACE-(BEGIN|END)/.test(bundle), false);
    assert.ok(harness.includes("Home widget"));
    assert.ok(harness.includes("Control widget"));
    assert.ok(harness.includes("refreshWidgetSurface"));
    assert.ok(harness.includes("toggleControlSurface"));
    assert.ok(bundle.includes("MobileSurfacesHomeWidget()"));
    assert.ok(bundle.includes("MobileSurfacesControlWidget()"));
    assert.ok(
      fs.existsSync(
        path.join(tmp, "apps/mobile/targets/widget/MobileSurfacesHomeWidget.swift"),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(tmp, "apps/mobile/targets/widget/MobileSurfacesControlWidget.swift"),
      ),
    );
    assert.deepEqual(indexAt(tmp), [
      "./queued.json",
      "./attention.json",
      "./active-progress.json",
      "./active-countdown.json",
      "./paused.json",
      "./bad-timing.json",
      "./completed.json",
      "./active-details.json",
      "./widget-dashboard.json",
      "./control-toggle.json",
    ]);
  });

  it("home-off: removes home-widget code, keeps control-widget code", () => {
    seedRealisticTree(tmp);
    applyStripGreenfield({ rootDir: tmp, surfaces: HOME_OFF });

    const harness = harnessAt(tmp);
    const bundle = bundleAt(tmp);

    assert.equal(/SURFACE-(BEGIN|END)/.test(harness), false);
    assert.equal(harness.includes("refreshWidgetSurface"), false);
    assert.equal(harness.includes("widgetSurfaceFixtures"), false);
    assert.equal(harness.includes("Home widget"), false);
    assert.ok(harness.includes("toggleControlSurface"));
    assert.ok(harness.includes("Control widget"));
    // Multi-id surfaceStatus state and section both stay because control
    // is still selected; markers themselves are gone.
    assert.ok(harness.includes("setSurfaceStatus"));
    assert.equal(bundle.includes("MobileSurfacesHomeWidget()"), false);
    assert.ok(bundle.includes("MobileSurfacesControlWidget()"));
    assert.equal(
      fs.existsSync(
        path.join(tmp, "apps/mobile/targets/widget/MobileSurfacesHomeWidget.swift"),
      ),
      false,
    );
    assert.ok(
      fs.existsSync(
        path.join(tmp, "apps/mobile/targets/widget/MobileSurfacesControlWidget.swift"),
      ),
    );
    assert.equal(indexAt(tmp).includes("./widget-dashboard.json"), false);
    assert.ok(indexAt(tmp).includes("./control-toggle.json"));
  });

  it("control-off: keeps home-widget code, removes control-widget code", () => {
    seedRealisticTree(tmp);
    applyStripGreenfield({ rootDir: tmp, surfaces: CONTROL_OFF });

    const harness = harnessAt(tmp);
    const bundle = bundleAt(tmp);

    assert.equal(/SURFACE-(BEGIN|END)/.test(harness), false);
    assert.equal(harness.includes("toggleControlSurface"), false);
    assert.equal(harness.includes("controlSurfaceFixtures"), false);
    assert.equal(harness.includes("Control widget"), false);
    assert.ok(harness.includes("refreshWidgetSurface"));
    assert.ok(harness.includes("Home widget"));
    assert.ok(bundle.includes("MobileSurfacesHomeWidget()"));
    assert.equal(bundle.includes("MobileSurfacesControlWidget()"), false);
    assert.ok(
      fs.existsSync(
        path.join(tmp, "apps/mobile/targets/widget/MobileSurfacesHomeWidget.swift"),
      ),
    );
    assert.equal(
      fs.existsSync(
        path.join(tmp, "apps/mobile/targets/widget/MobileSurfacesControlWidget.swift"),
      ),
      false,
    );
    assert.ok(indexAt(tmp).includes("./widget-dashboard.json"));
    assert.equal(indexAt(tmp).includes("./control-toggle.json"), false);
  });

  it("both-off: removes every widget/control reference and the surfaceStorage import", () => {
    seedRealisticTree(tmp);
    applyStripGreenfield({ rootDir: tmp, surfaces: ALL_OFF });

    const harness = harnessAt(tmp);
    const bundle = bundleAt(tmp);

    assert.equal(/SURFACE-(BEGIN|END)/.test(harness), false);
    assert.equal(harness.includes("refreshWidgetSurface"), false);
    assert.equal(harness.includes("toggleControlSurface"), false);
    assert.equal(harness.includes("widgetSurfaceFixtures"), false);
    assert.equal(harness.includes("controlSurfaceFixtures"), false);
    // The wrapping multi-id marker means the surfaceStorage import block is
    // dropped entirely — no empty `import {} from "..."` remnant.
    assert.equal(harness.includes("from \"../surfaceStorage\""), false);
    assert.equal(harness.includes("setSurfaceStatus"), false);
    assert.equal(bundle.includes("MobileSurfacesHomeWidget()"), false);
    assert.equal(bundle.includes("MobileSurfacesControlWidget()"), false);
    assert.ok(bundle.includes("MobileSurfacesLiveActivity()"));
    assert.equal(
      fs.existsSync(
        path.join(tmp, "apps/mobile/targets/widget/MobileSurfacesHomeWidget.swift"),
      ),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(tmp, "apps/mobile/targets/widget/MobileSurfacesControlWidget.swift"),
      ),
      false,
    );
    assert.equal(indexAt(tmp).includes("./widget-dashboard.json"), false);
    assert.equal(indexAt(tmp).includes("./control-toggle.json"), false);
  });
});

describe("formatSurfaceSummary", () => {
  it("always includes live activity and lists selected widgets", () => {
    assert.equal(formatSurfaceSummary(ALL_ON), "live activity, home widget, control widget");
    assert.equal(formatSurfaceSummary(HOME_OFF), "live activity, control widget");
    assert.equal(formatSurfaceSummary(CONTROL_OFF), "live activity, home widget");
    assert.equal(formatSurfaceSummary(ALL_OFF), "live activity");
  });
});
