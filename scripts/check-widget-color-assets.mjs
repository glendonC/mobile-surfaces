#!/usr/bin/env node
// Enforces MS045: every Color("literal") asset reference in the widget
// target's Swift resolves to a colorset that @bacons/apple-targets actually
// generates on disk.
//
// The silent failure: @bacons/apple-targets generates one *.colorset
// directory per key in the `colors` map of expo-target.config.js. Those keys
// are the literal config keys ($accent, $widgetBackground), so the on-disk
// asset names are Assets.xcassets/$accent.colorset and
// $widgetBackground.colorset. SwiftUI `Color("name")` for a name with no
// matching colorset does NOT crash — it silently falls back to a default
// color — so a Swift file that says Color("AccentColor") while the catalog
// only holds $accent.colorset compiles, ships, and renders the wrong color
// with no error anywhere. That is the exact silent-failure class the trap
// catalog exists to surface.
//
// Two config keys are magic. @bacons/apple-targets binds:
//   $accent           -> ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME
//   $widgetBackground -> ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME
// `$accent` is the target's global accent color. The idiomatic SwiftUI
// reference for it is `Color.accentColor` (no string literal); a literal
// `Color("$accent")` is also valid because the colorset is genuinely named
// `$accent` on disk. `$widgetBackground` has no Color member, so it is
// referenced as the literal `Color("$widgetBackground")`.
//
// The gate is structural:
//   1. parse the `colors` (and any `icon`/`image`) keys declared in
//      expo-target.config.js;
//   2. list the actual *.colorset directories under the widget
//      Assets.xcassets;
//   3. extract every Color("...") string literal and Color.accentColor
//      reference from the widget Swift files (comments stripped first);
//   4. fail when a Color("literal") names no colorset on disk.
//
// It also reports a consistency issue when a declared `colors` key has no
// matching colorset directory (codegen drift) — a generate-widget-colors run
// is overdue — but the load-bearing failure is the dangling Swift reference.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-widget-color-assets";
const WIDGET_DIR = resolve("apps/mobile/targets/widget");
const CONFIG_PATH = join(WIDGET_DIR, "expo-target.config.js");
const ASSETS_DIR = join(WIDGET_DIR, "Assets.xcassets");

function fail(summary, issues, message) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "widget-color-assets",
        status: "fail",
        summary,
        trapId: "MS045",
        ...(issues
          ? {
              detail: {
                message:
                  message ??
                  "Every Color(\"literal\") in the widget Swift must name a colorset @bacons/apple-targets generates from a `colors` key in expo-target.config.js. SwiftUI silently falls back to a default color for a missing asset, so a dangling reference renders the wrong brand color with no error.",
                issues,
              },
            }
          : {}),
      },
    ]),
    { json: values.json },
  );
}

// Blank // and /* */ comments in a JS/Swift source so a marker that survives
// only inside a comment cannot register. Same-length output so this could be
// swapped for stripNonCode, but the widget Swift is not TS/JS and a colorset
// name legitimately appears inside a Swift string literal we WANT to read, so
// a comment-only blanker is the correct tool here.
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && src.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

if (!existsSync(WIDGET_DIR) || !statSync(WIDGET_DIR).isDirectory()) {
  // No widget target — nothing to check. A project without the widget target
  // is out of scope (mirrors MS026's "skip when absent" posture).
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "widget-color-assets",
        status: "ok",
        summary:
          "No apps/mobile/targets/widget directory present; nothing to check.",
        trapId: "MS045",
      },
    ]),
    { json: values.json },
  );
  process.exit(0);
}

if (!existsSync(CONFIG_PATH)) {
  fail(
    `${relative(process.cwd(), CONFIG_PATH)} not found — the widget target must declare its asset keys in expo-target.config.js.`,
    null,
  );
}

const issues = [];

// ---------------------------------------------------------------------------
// 1. Parse the declared `colors` (and `icon`/`image`) keys from the config.
//    The config is a CJS module exporting a function; the `colors` value is
//    computed, but its KEYS are static object literals, so a structural
//    parse of the `colors: { ... }` block is reliable and avoids executing
//    arbitrary config code.
// ---------------------------------------------------------------------------
const configSrc = stripComments(readFileSync(CONFIG_PATH, "utf8"));

function extractObjectBlock(src, keyName) {
  const re = new RegExp(`\\b${keyName}\\s*:\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

// Collect the top-level keys of an object-literal body. Keys may be bare
// identifiers ($accent), quoted strings ("$accent"), or computed — computed
// keys cannot be resolved statically and are reported. Only depth-0 keys of
// the body count, so a nested object's keys are not mistaken for declarations.
function objectKeys(body) {
  const keys = [];
  let depth = 0;
  let i = 0;
  const n = body.length;
  while (i < n) {
    const ch = body[i];
    if (ch === "{" || ch === "[" || ch === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // skip string literal
      const quote = ch;
      i += 1;
      while (i < n && body[i] !== quote) {
        if (body[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (depth === 0) {
      // A key is the token sequence immediately before a `:` at depth 0.
      // Match a bare identifier or a quoted string followed by `:`.
      const rest = body.slice(i);
      const keyMatch = /^\s*(?:(["'])([^"'\\]+)\1|([A-Za-z_$][\w$]*))\s*:/.exec(
        rest,
      );
      if (keyMatch) {
        keys.push(keyMatch[2] ?? keyMatch[3]);
        i += keyMatch[0].length;
        continue;
      }
    }
    i += 1;
  }
  return keys;
}

const colorsBody = extractObjectBlock(configSrc, "colors");
const declaredColorKeys = colorsBody ? objectKeys(colorsBody) : [];

if (!colorsBody) {
  // No colors block at all. If the widget Swift references Color("literal")
  // assets there is nothing to resolve them against — that is itself the
  // failure, surfaced below per dangling reference. A widget with no color
  // assets and no Color("literal") references is fine, so this is not a
  // hard fail on its own.
  declaredColorKeys.length = 0;
}

// ---------------------------------------------------------------------------
// 2. List the on-disk *.colorset directories.
// ---------------------------------------------------------------------------
const colorsetsOnDisk = new Set();
if (existsSync(ASSETS_DIR) && statSync(ASSETS_DIR).isDirectory()) {
  for (const entry of readdirSync(ASSETS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith(".colorset")) {
      colorsetsOnDisk.add(entry.name.slice(0, -".colorset".length));
    }
  }
}

// Drift check: a declared `colors` key with no matching colorset on disk
// means generate-widget-colors / prebuild has not materialized the catalog.
for (const key of declaredColorKeys) {
  if (!colorsetsOnDisk.has(key)) {
    issues.push({
      path: `expo-target.config.js#colors.${key}`,
      message: `colors key "${key}" has no matching ${key}.colorset directory under Assets.xcassets; run pnpm surface:codegen / prebuild so @bacons/apple-targets materializes it`,
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Extract Color("...") literals and Color.accentColor references from the
//    widget Swift files.
// ---------------------------------------------------------------------------
const swiftFiles = readdirSync(WIDGET_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".swift"))
  .map((e) => join(WIDGET_DIR, e.name));

// `$accent` is the magic global-accent key. Color.accentColor IS the
// idiomatic reference to it, and the literal Color("$accent") is valid too
// because the colorset is genuinely named $accent on disk. The set below is
// the literals that resolve without a colorset directory of that exact name.
const ACCENT_KEY = "$accent";

// A Color("literal") resolves when:
//   - a colorset of that exact name exists on disk, OR
//   - the literal is the magic accent key and a $accent.colorset exists.
function literalResolves(literal) {
  if (colorsetsOnDisk.has(literal)) return true;
  return false;
}

const colorLiteralRe = /\bColor\s*\(\s*"([^"]*)"\s*\)/g;

let swiftRefCount = 0;
for (const file of swiftFiles) {
  const src = stripComments(readFileSync(file, "utf8"));
  const rel = relative(process.cwd(), file);
  let m;
  colorLiteralRe.lastIndex = 0;
  while ((m = colorLiteralRe.exec(src)) !== null) {
    swiftRefCount += 1;
    const literal = m[1];
    const line = src.slice(0, m.index).split("\n").length;
    if (!literalResolves(literal)) {
      const colorsetList =
        [...colorsetsOnDisk].sort().map((c) => `${c}.colorset`).join(", ") ||
        "(none)";
      const hint =
        literal.toLowerCase().includes("accent") && colorsetsOnDisk.has(ACCENT_KEY)
          ? ` The global accent color is the colorset "${ACCENT_KEY}.colorset" (magic key bound to ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME); reference it as Color.accentColor or Color("${ACCENT_KEY}").`
          : "";
      issues.push({
        path: `${rel}:${line}`,
        message: `Color("${literal}") names no colorset on disk. Available colorsets: ${colorsetList}.${hint}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Emit.
// ---------------------------------------------------------------------------
if (issues.length > 0) {
  const dangling = issues.filter((i) => i.path.includes(".swift:")).length;
  fail(
    dangling > 0
      ? `${dangling} widget Swift Color("...") reference${dangling === 1 ? "" : "s"} resolve to no colorset on disk (silent SwiftUI fallback).`
      : `Widget color-asset declarations drifted from the on-disk asset catalog.`,
    issues,
  );
}

emitDiagnosticReport(
  buildReport(TOOL, [
    {
      id: "widget-color-assets",
      status: "ok",
      summary: `Every widget Color("...") reference resolves to a colorset on disk (${swiftRefCount} reference(s) checked against ${colorsetsOnDisk.size} colorset(s); ${declaredColorKeys.length} colors key(s) declared in expo-target.config.js).`,
      trapId: "MS045",
    },
  ]),
  { json: values.json },
);
