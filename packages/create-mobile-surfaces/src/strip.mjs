// Surface-picker strip pass. Removes blocks of code keyed to deselected
// surfaces, deletes surface-specific files, prunes the fixture index, and
// regenerates the TS fixture bundle so the user gets exactly what they
// asked for at scaffold time.
//
// Marker grammar lives in source files (DiagnosticsScreen.tsx,
// MobileSurfacesWidgetBundle.swift). Each region is bounded by:
//
//   // SURFACE-BEGIN: <ids>     ... // SURFACE-END: <ids>
//   {/* SURFACE-BEGIN: <ids> */} ... {/* SURFACE-END: <ids> */}
//
// where `<ids>` is one or more space-separated surface ids ("home-widget",
// "control-widget"). A region is content-stripped only when *every* listed
// id is deselected; otherwise the marker lines themselves are removed but
// the content stays. Markers are always removed from the output so users
// never see "SURFACE-BEGIN" comments in their generated project.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTextFileFilter, walkFiles } from "./fs-walk.mjs";

// Surface ids (kebab) → selection keys (camel). The picker returns
// { homeWidget: bool, controlWidget: bool } and markers cite the kebab id.
const SELECTION_KEY_BY_ID = Object.freeze({
  "home-widget": "homeWidget",
  "control-widget": "controlWidget",
  "lock-accessory-widget": "lockAccessoryWidget",
  "standby-widget": "standbyWidget",
});

// Skip these directories when walking. The strip pass runs on a freshly
// extracted template (no node_modules yet), but the list is defensive: if
// the caller hands us a tree that already has them, we don't want to
// touch generated content.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "ios",
  "android",
  "dist",
  "build",
  ".turbo",
  ".next",
  ".expo",
]);

const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".swift",
  ".json",
  ".md",
]);

// Marker grammars. Two forms: line comment (TS/JS/Swift) and JSX comment
// (inside JSX bodies). A line must consist of *only* the marker (modulo
// whitespace) so a misplaced inline comment does not get misread as a
// region boundary.
const LINE_RE = /^\s*\/\/\s*SURFACE-(BEGIN|END):\s*(.+?)\s*$/;
const JSX_RE = /^\s*\{\s*\/\*\s*SURFACE-(BEGIN|END):\s*(.+?)\s*\*\/\s*\}\s*$/;

function parseMarker(line) {
  const m = line.match(LINE_RE) || line.match(JSX_RE);
  if (!m) return null;
  return {
    kind: m[1].toLowerCase(),
    ids: m[2].trim().split(/\s+/),
  };
}

function shouldStripContent(ids, surfaces) {
  for (const id of ids) {
    const key = SELECTION_KEY_BY_ID[id];
    if (!key) {
      throw new Error(
        `Unknown SURFACE id "${id}". Known: ${Object.keys(SELECTION_KEY_BY_ID).join(", ")}.`,
      );
    }
    // If any cited surface is selected, the block stays — the block exists
    // because at least one of its surfaces does.
    if (surfaces[key]) return false;
  }
  return true;
}

// Pure, exported for tests. Given a file body and selections, return the
// post-strip body. Throws on malformed markers (unmatched begin/end,
// mismatched id list) so misspelled markers fail loudly rather than silently
// stripping code or leaving orphan markers.
export function processFileContent(content, surfaces) {
  // Fast path: only skip the parser when the file has no markers at all.
  // A file with an END but no BEGIN must still go through the parser so the
  // unmatched-end is reported (silent acceptance would let typos hide).
  if (
    !content.includes("SURFACE-BEGIN:") &&
    !content.includes("SURFACE-END:")
  ) {
    return content;
  }

  const lines = content.split("\n");
  const stack = [];
  const regions = [];

  for (let i = 0; i < lines.length; i++) {
    const m = parseMarker(lines[i]);
    if (!m) continue;
    if (m.kind === "begin") {
      stack.push({
        ids: m.ids,
        idsKey: m.ids.slice().sort().join(" "),
        startIdx: i,
      });
    } else {
      if (stack.length === 0) {
        throw new Error(`SURFACE-END at line ${i + 1} has no matching BEGIN.`);
      }
      const top = stack.pop();
      const endKey = m.ids.slice().sort().join(" ");
      if (top.idsKey !== endKey) {
        throw new Error(
          `SURFACE-END at line ${i + 1} (ids "${m.ids.join(" ")}") does not match SURFACE-BEGIN at line ${top.startIdx + 1} (ids "${top.ids.join(" ")}").`,
        );
      }
      regions.push({ ids: top.ids, startIdx: top.startIdx, endIdx: i });
    }
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    throw new Error(
      `SURFACE-BEGIN at line ${top.startIdx + 1} (ids "${top.ids.join(" ")}") has no matching END.`,
    );
  }

  const drop = new Set();
  for (const r of regions) {
    if (shouldStripContent(r.ids, surfaces)) {
      for (let i = r.startIdx; i <= r.endIdx; i++) drop.add(i);
    } else {
      drop.add(r.startIdx);
      drop.add(r.endIdx);
    }
  }
  if (drop.size === 0) return content;

  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

const IS_TEXT_FILE = makeTextFileFilter({ textExts: TEXT_EXTS });

// Walk a directory subtree applying the marker pass. Skips files without a
// SURFACE-BEGIN marker entirely (cheap substring check before the parse).
// Returns the list of relative paths actually rewritten.
export function stripMarkersInTree({ rootDir, surfaces, scopeDir = rootDir }) {
  const rewritten = [];
  const files = walkFiles({
    rootDir: scopeDir,
    skipDirs: SKIP_DIRS,
    filter: IS_TEXT_FILE,
  });
  for (const file of files) {
    const before = fs.readFileSync(file, "utf8");
    if (
      !before.includes("SURFACE-BEGIN:") &&
      !before.includes("SURFACE-END:")
    ) {
      continue;
    }
    const after = processFileContent(before, surfaces);
    if (after !== before) {
      fs.writeFileSync(file, after);
      rewritten.push(path.relative(rootDir, file));
    }
  }
  return rewritten;
}

// Files keyed by surface id (camelCase selection key). When a surface is
// deselected, every path here is unlinked from the project.
const GREENFIELD_FILES_BY_SURFACE = Object.freeze({
  homeWidget: [
    "apps/mobile/targets/widget/MobileSurfacesHomeWidget.swift",
    "data/surface-fixtures/widget-dashboard.json",
  ],
  controlWidget: [
    "apps/mobile/targets/widget/MobileSurfacesControlWidget.swift",
    "data/surface-fixtures/control-toggle.json",
  ],
  lockAccessoryWidget: [
    "apps/mobile/targets/widget/MobileSurfacesLockAccessoryWidget.swift",
    "data/surface-fixtures/lock-accessory-circular.json",
  ],
  standbyWidget: [
    "apps/mobile/targets/widget/MobileSurfacesStandbyWidget.swift",
    "data/surface-fixtures/standby-card.json",
  ],
});

// In add-to-existing, only the widget target dir is copied; fixtures and
// other files never reach the user's project. The widget-dir variant only
// removes the surface-specific Swift files.
const WIDGET_DIR_FILES_BY_SURFACE = Object.freeze({
  homeWidget: ["MobileSurfacesHomeWidget.swift"],
  controlWidget: ["MobileSurfacesControlWidget.swift"],
  lockAccessoryWidget: ["MobileSurfacesLockAccessoryWidget.swift"],
  standbyWidget: ["MobileSurfacesStandbyWidget.swift"],
});

// Fixture-index entries to drop, keyed by selection key.
const FIXTURE_INDEX_PATH_BY_SURFACE = Object.freeze({
  homeWidget: "./widget-dashboard.json",
  controlWidget: "./control-toggle.json",
  lockAccessoryWidget: "./lock-accessory-circular.json",
  standbyWidget: "./standby-card.json",
});

function deleteRelativeFiles({ rootDir, surfaces, byKey }) {
  const deleted = [];
  for (const [key, paths] of Object.entries(byKey)) {
    if (surfaces[key]) continue;
    for (const rel of paths) {
      const abs = path.join(rootDir, rel);
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
        deleted.push(rel);
      }
    }
  }
  return deleted;
}

function pruneFixtureIndex({ rootDir, surfaces }) {
  const indexPath = path.join(rootDir, "data/surface-fixtures/index.json");
  if (!fs.existsSync(indexPath)) return false;
  const original = fs.readFileSync(indexPath, "utf8");
  const list = JSON.parse(original);
  const drop = new Set();
  for (const [key, fixture] of Object.entries(FIXTURE_INDEX_PATH_BY_SURFACE)) {
    if (!surfaces[key]) drop.add(fixture);
  }
  const filtered = list.filter((entry) => !drop.has(entry));
  if (filtered.length === list.length) return false;
  const trailing = original.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(indexPath, JSON.stringify(filtered, null, 2) + trailing);
  return true;
}

function regenerateFixtures(rootDir) {
  const generator = path.join(
    rootDir,
    "scripts",
    "generate-surface-fixtures.mjs",
  );
  if (!fs.existsSync(generator)) return false;
  const result = spawnSync("node", [generator], { cwd: rootDir });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString?.() ?? "";
    throw new Error(
      `generate-surface-fixtures.mjs exited with ${result.status}: ${stderr}`,
    );
  }
  return true;
}

// Greenfield strip: full tree pass. Called between template extraction and
// the rename-starter step, so identifiers are still "MobileSurfaces*" — file
// deletion paths are stable and don't need to know the user's swift prefix.
export function applyStripGreenfield({ rootDir, surfaces }) {
  const summary = {
    filesStripped: stripMarkersInTree({ rootDir, surfaces }),
    filesDeleted: deleteRelativeFiles({
      rootDir,
      surfaces,
      byKey: GREENFIELD_FILES_BY_SURFACE,
    }),
    indexUpdated: pruneFixtureIndex({ rootDir, surfaces }),
    fixturesRegenerated: false,
  };
  if (
    summary.indexUpdated ||
    summary.filesDeleted.some((p) => p.startsWith("data/surface-fixtures/"))
  ) {
    summary.fixturesRegenerated = regenerateFixtures(rootDir);
  }
  return summary;
}

// Add-to-existing strip: only the freshly-copied widget dir is in scope.
// Bundled-in source files (harness, etc.) live in the user's existing tree
// and are not touched. The user's app may also have unrelated SURFACE-style
// comments by coincidence — we scope strictly to the widget dir to avoid
// false positives.
export function applyStripWidgetDir({ widgetDir, surfaces }) {
  return {
    filesStripped: stripMarkersInTree({
      rootDir: widgetDir,
      surfaces,
      scopeDir: widgetDir,
    }),
    filesDeleted: deleteRelativeFiles({
      rootDir: widgetDir,
      surfaces,
      byKey: WIDGET_DIR_FILES_BY_SURFACE,
    }),
  };
}

// Convenience formatter for log output. Returns a short, human-friendly
// line describing the picker outcome. "Live activity" is always present.
export function formatSurfaceSummary(surfaces) {
  const parts = ["live activity"];
  if (surfaces.homeWidget) parts.push("home widget");
  if (surfaces.controlWidget) parts.push("control widget");
  if (surfaces.lockAccessoryWidget) parts.push("lock accessory");
  if (surfaces.standbyWidget) parts.push("standby");
  return parts.join(", ");
}
