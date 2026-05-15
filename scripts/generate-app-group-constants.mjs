#!/usr/bin/env node
// Generates the App Group identifier constants for Swift and TypeScript
// consumers from a single source of truth: apps/mobile/app.json at
// `expo.ios.entitlements["com.apple.security.application-groups"][0]`.
//
// Two output files are written, each with a header pointing back at the
// source and the regen command:
//   - apps/mobile/targets/widget/_shared/MobileSurfacesAppGroup.swift
//   - apps/mobile/src/generated/appGroup.ts
//
// MobileSurfacesSharedState.swift, surfaceStorage/index.ts, and
// diagnostics/checkSetup.ts all reference these constants rather than
// inlining a string literal. check-app-group-identity.mjs verifies the four
// remaining declaration sites (app.json, generated.entitlements, the
// generated Swift, the generated TS) agree.
//
// Pass --check to compare on-disk against the regenerated output and exit
// non-zero on drift (CI guard; same shape as build-schema.mjs --check).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const TOOL = "generate-app-group-constants";
const APP_JSON = path.resolve("apps/mobile/app.json");
const SWIFT_OUT = path.resolve(
  "apps/mobile/targets/widget/_shared/MobileSurfacesAppGroup.swift",
);
const TS_OUT = path.resolve("apps/mobile/src/generated/appGroup.ts");

const HEADER_LINE_1 =
  "// GENERATED - DO NOT EDIT. Source: apps/mobile/app.json.";
const HEADER_LINE_2 = "// Regenerate: pnpm surface:codegen";

function readAppGroup() {
  if (!fs.existsSync(APP_JSON)) {
    throw new Error(`apps/mobile/app.json not found at ${APP_JSON}`);
  }
  const json = JSON.parse(fs.readFileSync(APP_JSON, "utf8"));
  const groups =
    json?.expo?.ios?.entitlements?.["com.apple.security.application-groups"];
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error(
      "expo.ios.entitlements['com.apple.security.application-groups'] missing or empty in app.json",
    );
  }
  if (groups.length > 1) {
    throw new Error(
      `expected exactly one App Group, found ${groups.length}: ${groups.join(", ")}`,
    );
  }
  if (typeof groups[0] !== "string" || !groups[0]) {
    throw new Error("App Group entry is not a non-empty string");
  }
  return groups[0];
}

function renderSwift(identifier) {
  return (
    `${HEADER_LINE_1}\n` +
    `${HEADER_LINE_2}\n` +
    `\n` +
    `import Foundation\n` +
    `\n` +
    `enum MobileSurfacesAppGroup {\n` +
    `  static let identifier = "${identifier}"\n` +
    `}\n`
  );
}

function renderTs(identifier) {
  return (
    `${HEADER_LINE_1}\n` +
    `${HEADER_LINE_2}\n` +
    `\n` +
    `export const APP_GROUP = "${identifier}" as const;\n`
  );
}

let identifier;
try {
  identifier = readAppGroup();
} catch (err) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "read-source",
        status: "fail",
        summary: `Could not read App Group from app.json: ${err.message}`,
        trapId: "MS013",
      },
    ]),
    { json: values.json },
  );
}

const swiftSource = renderSwift(identifier);
const tsSource = renderTs(identifier);

if (values.check) {
  const swiftCurrent = fs.existsSync(SWIFT_OUT)
    ? fs.readFileSync(SWIFT_OUT, "utf8")
    : "";
  const tsCurrent = fs.existsSync(TS_OUT) ? fs.readFileSync(TS_OUT, "utf8") : "";
  const swiftInSync = swiftCurrent === swiftSource;
  const tsInSync = tsCurrent === tsSource;
  const issues = [];
  if (!swiftInSync) {
    issues.push({
      path: path.relative(process.cwd(), SWIFT_OUT),
      message: "out of sync with apps/mobile/app.json",
    });
  }
  if (!tsInSync) {
    issues.push({
      path: path.relative(process.cwd(), TS_OUT),
      message: "out of sync with apps/mobile/app.json",
    });
  }
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "app-group-codegen-sync",
        status: issues.length === 0 ? "ok" : "fail",
        trapId: "MS013",
        summary:
          issues.length === 0
            ? "Generated App Group constants are in sync with app.json."
            : `${issues.length} generated file(s) out of sync.`,
        ...(issues.length === 0
          ? {}
          : {
              detail: {
                message:
                  "Run: node --experimental-strip-types scripts/generate-app-group-constants.mjs",
                issues,
              },
            }),
      },
    ]),
    { json: values.json },
  );
} else {
  fs.mkdirSync(path.dirname(SWIFT_OUT), { recursive: true });
  fs.mkdirSync(path.dirname(TS_OUT), { recursive: true });
  fs.writeFileSync(SWIFT_OUT, swiftSource);
  fs.writeFileSync(TS_OUT, tsSource);
  if (values.json) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "app-group-codegen-write",
          status: "ok",
          summary: `Wrote ${path.relative(process.cwd(), SWIFT_OUT)} and ${path.relative(process.cwd(), TS_OUT)}.`,
        },
      ]),
      { json: true },
    );
  } else {
    console.log(
      `Wrote ${path.relative(process.cwd(), SWIFT_OUT)} and ${path.relative(process.cwd(), TS_OUT)}.`,
    );
  }
}
