// End-to-end tests for scripts/check-widget-color-assets.mjs (MS045).
//
// MS045 catches a real silent failure: @bacons/apple-targets generates one
// *.colorset directory per key in the `colors` map of expo-target.config.js
// (the literal keys $accent / $widgetBackground), so a Swift Color("...")
// literal naming anything else resolves to nothing. SwiftUI does not crash on
// a missing color asset — it silently falls back to a default — so the gate
// is the only thing standing between a brand-palette regression and a
// customer device.
//
// Each case synthesizes a widget target (expo-target.config.js + an
// Assets.xcassets with colorset directories + Swift files) and runs the
// check as a subprocess, the same code path CI runs. The "corrected" fixture
// mirrors the real repo's post-fix Swift (Color.accentColor /
// Color("$widgetBackground")); the "original bug" fixture reproduces the
// Color("AccentColor") / Color("WidgetBackground") drift.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-widget-color-assets.mjs");

// The config that mirrors the real repo: a CJS module exporting a function,
// with a `colors` map whose keys are the two magic keys.
const REAL_CONFIG = `const COLORS = require("./colors.generated.cjs");
/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "MobileSurfacesWidget",
  colors: {
    $accent: COLORS.AccentColor,
    $widgetBackground: COLORS.WidgetBackground,
  },
});
`;

const COLORSET_CONTENTS = JSON.stringify({
  colors: [{ idiom: "universal" }],
  info: { version: 1, author: "expo" },
});

// Build a throwaway widget target. `opts.config` overrides the config source;
// `opts.colorsets` is the list of colorset names to materialize on disk;
// `opts.swift` maps a Swift filename to its contents.
function withWidget(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-colorassets-"));
  const widgetDir = join(dir, "apps", "mobile", "targets", "widget");
  const assetsDir = join(widgetDir, "Assets.xcassets");
  mkdirSync(assetsDir, { recursive: true });

  writeFileSync(
    join(widgetDir, "expo-target.config.js"),
    opts.config ?? REAL_CONFIG,
  );
  writeFileSync(
    join(widgetDir, "colors.generated.cjs"),
    'module.exports = { AccentColor: "#7BA591", WidgetBackground: "#F7F5F0" };\n',
  );

  for (const name of opts.colorsets ?? ["$accent", "$widgetBackground"]) {
    const cs = join(assetsDir, `${name}.colorset`);
    mkdirSync(cs, { recursive: true });
    writeFileSync(join(cs, "Contents.json"), COLORSET_CONTENTS);
  }

  for (const [name, contents] of Object.entries(opts.swift ?? {})) {
    writeFileSync(join(widgetDir, name), contents);
  }

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCheck(cwd) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

// The Swift the repo ships AFTER the parallel iOS fix: the accent is
// referenced via Color.accentColor (the magic $accent global accent), the
// background via the literal Color("$widgetBackground").
const CORRECTED_SWIFT = `import SwiftUI
import WidgetKit

struct W: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "w", provider: P()) { entry in
      V(entry: entry).containerBackground(Color("$widgetBackground"), for: .widget)
    }
    .tint(Color.accentColor)
  }
}
`;

// The original bug: Color("AccentColor") / Color("WidgetBackground") — names
// that no colorset on disk matches.
const BUGGY_SWIFT = `import SwiftUI
import WidgetKit

struct W: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "w", provider: P()) { entry in
      V(entry: entry).containerBackground(Color("WidgetBackground"), for: .widget)
    }
    .tint(Color("AccentColor"))
  }
}
`;

test("passes on the corrected Swift (Color.accentColor / Color(\"$widgetBackground\"))", () => {
  const ws = withWidget({ swift: { "Widget.swift": CORRECTED_SWIFT } });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /MS045/);
    assert.match(r.stdout, /resolves to a colorset/);
  } finally {
    ws.cleanup();
  }
});

test("catches the original bug: Color(\"AccentColor\") with no AccentColor.colorset", () => {
  const ws = withWidget({ swift: { "Widget.swift": BUGGY_SWIFT } });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0, "the dangling reference must fail the gate");
    assert.match(r.stdout, /MS045/);
    assert.match(r.stdout, /Color\("AccentColor"\)/);
    assert.match(r.stdout, /Color\("WidgetBackground"\)/);
    // The accent hint must point at the magic-key fix.
    assert.match(r.stdout, /Color\.accentColor/);
  } finally {
    ws.cleanup();
  }
});

test("catches a single dangling reference among otherwise-correct ones", () => {
  // Mutation: one good literal, one bad. The gate must flag exactly the bad.
  const swift =
    'import SwiftUI\n' +
    'let a = Color("$widgetBackground")\n' +
    'let b = Color("Brand")\n';
  const ws = withWidget({ swift: { "Widget.swift": swift } });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /Color\("Brand"\)/);
    assert.doesNotMatch(r.stdout, /Color\("\$widgetBackground"\)/);
  } finally {
    ws.cleanup();
  }
});

test("Color(\"$accent\") literal is valid — the colorset is genuinely named $accent", () => {
  // The magic accent key may also be referenced by its literal name; the
  // colorset $accent.colorset exists on disk, so it resolves.
  const swift = 'import SwiftUI\nlet a = Color("$accent")\n';
  const ws = withWidget({ swift: { "Widget.swift": swift } });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("Color.accentColor (no literal) is never flagged", () => {
  // A member reference carries no asset name; it resolves to the target
  // global accent and is correct by construction.
  const swift = 'import SwiftUI\nlet a = Color.accentColor\nlet b = Color.primary\n';
  const ws = withWidget({ swift: { "Widget.swift": swift } });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("a Color(\"...\") that survives only inside a comment is not flagged", () => {
  // Comment stripping: a commented-out dangling reference is not a violation.
  const swift =
    'import SwiftUI\n' +
    '// let stale = Color("AccentColor")\n' +
    '/* let blockStale = Color("WidgetBackground") */\n' +
    'let ok = Color("$widgetBackground")\n';
  const ws = withWidget({ swift: { "Widget.swift": swift } });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("flags a declared colors key with no matching colorset directory (codegen drift)", () => {
  // The config declares $accent and $widgetBackground, but the catalog is
  // missing $widgetBackground.colorset — prebuild / codegen is overdue.
  const ws = withWidget({
    colorsets: ["$accent"],
    swift: { "Widget.swift": 'import SwiftUI\nlet a = Color.accentColor\n' },
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /\$widgetBackground/);
    assert.match(r.stdout, /colors key/);
  } finally {
    ws.cleanup();
  }
});

test("a literal that matches a declared key but missing colorset still fails", () => {
  // Defense in depth: even though $widgetBackground is a declared colors key,
  // a Color("$widgetBackground") reference fails when the colorset is not on
  // disk — the gate resolves against the actual asset catalog, not the config.
  const ws = withWidget({
    colorsets: ["$accent"],
    swift: {
      "Widget.swift": 'import SwiftUI\nlet a = Color("$widgetBackground")\n',
    },
  });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /Color\("\$widgetBackground"\)/);
  } finally {
    ws.cleanup();
  }
});

test("L8: flags Color(uiColor: UIColor(named: \"X\")) against the colorset list", () => {
  // The original MS045 gate only matched the Color("literal") form. The
  // UIKit-bridge path Color(uiColor: UIColor(named: "X")) is a second way
  // to reference an asset by name; without coverage, a brand-palette
  // regression introduced via this shape silently ships. Closure for L8.
  const swift =
    'import SwiftUI\n' +
    'import UIKit\n' +
    'let bad = Color(uiColor: UIColor(named: "AccentColor")!)\n';
  const ws = withWidget({ swift: { "Widget.swift": swift } });
  try {
    const r = runCheck(ws.dir);
    assert.notEqual(
      r.status,
      0,
      "UIColor(named: \"AccentColor\") with no AccentColor.colorset must fail",
    );
    assert.match(r.stdout, /AccentColor/);
  } finally {
    ws.cleanup();
  }
});

test("L8: Color(uiColor: UIColor(named: \"$widgetBackground\")) resolves when the colorset exists", () => {
  const swift =
    'import SwiftUI\n' +
    'import UIKit\n' +
    'let ok = Color(uiColor: UIColor(named: "$widgetBackground")!)\n';
  const ws = withWidget({ swift: { "Widget.swift": swift } });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("L8: Color(.staticMember) (no asset name) is not flagged", () => {
  // Color(.brandAccent) calls a static Color extension; no asset catalog
  // lookup happens. The gate must not false-fail on this shape.
  const swift =
    'import SwiftUI\n' +
    'extension Color { static let brandAccent = Color.accentColor }\n' +
    'let a = Color(.brandAccent)\n';
  const ws = withWidget({ swift: { "Widget.swift": swift } });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    ws.cleanup();
  }
});

test("L8: dynamic-name Color(name) is documented as out of scope, not silently passed", () => {
  // Name resolution from a variable is undecidable from text. The gate does
  // not flag it, but the README/header on the script must say so explicitly,
  // and a Color("$accent") form alongside must still resolve. Pin both: the
  // dynamic form does not cause a false fail, and the literal sibling does.
  const swift =
    'import SwiftUI\n' +
    'let name = "AccentColor"\n' +
    'let dyn = Color(name)\n' +
    'let lit = Color("$accent")\n';
  const ws = withWidget({ swift: { "Widget.swift": swift } });
  try {
    const r = runCheck(ws.dir);
    assert.equal(
      r.status,
      0,
      "dynamic-name Color(name) is out of scope; the literal must still pass. Output:\n" +
        r.stdout +
        r.stderr,
    );
  } finally {
    ws.cleanup();
  }
});

test("parses quoted colors keys in expo-target.config.js", () => {
  // The keys may be written as quoted strings; the structural parser must
  // read them the same as bare-identifier keys.
  const config = `module.exports = (config) => ({
  type: "widget",
  colors: {
    "$accent": {},
    "$widgetBackground": {},
  },
});
`;
  const ws = withWidget({
    config,
    swift: {
      "Widget.swift":
        'import SwiftUI\nlet a = Color("$widgetBackground")\nlet b = Color.accentColor\n',
    },
  });
  try {
    const r = runCheck(ws.dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /2 colors key\(s\) declared/);
  } finally {
    ws.cleanup();
  }
});

test("ok when there is no widget target directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-colorassets-none-"));
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /nothing to check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails cleanly when expo-target.config.js is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ms-check-colorassets-noconfig-"));
  try {
    mkdirSync(join(dir, "apps", "mobile", "targets", "widget"), {
      recursive: true,
    });
    const r = runCheck(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /expo-target\.config\.js not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
