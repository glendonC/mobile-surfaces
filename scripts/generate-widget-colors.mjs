#!/usr/bin/env node
// Generates the widget asset-catalog colors from the single source of truth
// for the brand palette, apps/mobile/src/theme.ts.
//
// Why generated: @bacons/apple-targets reads apps/mobile/targets/widget/
// expo-target.config.js at prebuild time to materialize the widget target's
// asset catalog. That file needs two hex values (the accent color and the
// widget background). They are the same two values the React Native app reads
// from theme.ts. Inlining them in expo-target.config.js left two copies with
// only a "keep in sync" comment between them: a silent drift point in a repo
// that gates every other shared constant.
//
// Output: apps/mobile/targets/widget/colors.generated.cjs, a CommonJS module
// expo-target.config.js requires. CJS (not JSON) so the file can carry the
// DO-NOT-EDIT header, and (not TS) so @bacons/apple-targets' prebuild-time
// require() needs no TypeScript interop.
//
// The theme-token -> asset-color mapping lives here and only here:
//   surfaceColors.primary -> AccentColor
//   surfaceColors.surface -> WidgetBackground
//
// Pass --check to compare on-disk against the regenerated output and exit
// non-zero on drift (CI guard; same shape as generate-schema-version.mjs).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { surfaceColors } from "../apps/mobile/src/theme.ts";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const TOOL = "generate-widget-colors";
const OUT = path.resolve("apps/mobile/targets/widget/colors.generated.cjs");

// The one place the theme-token -> asset-catalog-color mapping is declared.
const COLOR_MAP = {
  AccentColor: surfaceColors.primary,
  WidgetBackground: surfaceColors.surface,
};

function render(colors) {
  const entries = Object.entries(colors)
    .map(([name, hex]) => `  ${name}: ${JSON.stringify(hex)},`)
    .join("\n");
  return (
    "// GENERATED - DO NOT EDIT. Source: apps/mobile/src/theme.ts.\n" +
    "// Regenerate: pnpm surface:codegen\n" +
    "//\n" +
    "// Widget asset-catalog colors, derived from the brand palette in\n" +
    "// theme.ts. expo-target.config.js requires this file so the widget\n" +
    "// target and the React Native app render the same accent and background.\n" +
    "\n" +
    `module.exports = {\n${entries}\n};\n`
  );
}

const output = render(COLOR_MAP);

if (values.check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  const inSync = current === output;
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "widget-colors-codegen-sync",
        status: inSync ? "ok" : "fail",
        summary: inSync
          ? "colors.generated.cjs is in sync with theme.ts."
          : "colors.generated.cjs is out of sync with theme.ts.",
        ...(inSync
          ? {}
          : {
              detail: {
                message:
                  "Run: node --experimental-strip-types scripts/generate-widget-colors.mjs",
                issues: [
                  {
                    path: path.relative(process.cwd(), OUT),
                    message: "out of sync with apps/mobile/src/theme.ts",
                  },
                ],
              },
            }),
      },
    ]),
    { json: values.json },
  );
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, output);
  const wrote = path.relative(process.cwd(), OUT);
  if (values.json) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "widget-colors-codegen-write",
          status: "ok",
          summary: `Wrote ${wrote}.`,
        },
      ]),
      { json: true },
    );
  } else {
    console.log(`Wrote ${wrote}.`);
  }
}
