#!/usr/bin/env node
// Generates the Swift EXPECTED_SCHEMA_VERSION constant from the single source
// of truth for the wire-format generation, packages/surface-contracts/src/
// version.ts.
//
// Why generated: the widget, control, and notification-content extensions
// run a `{ schemaVersion: String }` probe decode against EXPECTED_SCHEMA_VERSION
// before the full struct decode (MS041). If that Swift constant drifts below
// the Zod `schemaVersion` literal, the extensions render a version-mismatch
// placeholder against a schema that is actually current; if it drifts above,
// they decode an older shape as if current. Generating it from version.ts
// makes the drift impossible.
//
// Output: apps/mobile/targets/_shared/MobileSurfacesSchemaVersion.swift, a
// _shared file with app + extension target membership. MobileSurfacesSharedState.swift
// references the constant but no longer declares it.
//
// Pass --check to compare on-disk against the regenerated output and exit
// non-zero on drift (CI guard; same shape as generate-app-group-constants.mjs).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import { SCHEMA_VERSION } from "../packages/surface-contracts/src/version.ts";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const TOOL = "generate-schema-version";
const SWIFT_OUT = path.resolve(
  "apps/mobile/targets/_shared/MobileSurfacesSchemaVersion.swift",
);

function render(version) {
  return (
    "// GENERATED - DO NOT EDIT. Source: packages/surface-contracts/src/version.ts.\n" +
    "// Regenerate: pnpm surface:codegen\n" +
    "\n" +
    "import Foundation\n" +
    "\n" +
    "/// Wire-format generation this binary was compiled against. The widget,\n" +
    "/// control, and notification-content extensions probe a host snapshot's\n" +
    "/// schemaVersion against this value before the full decode and render a\n" +
    "/// version-mismatch placeholder on a mismatch instead of decoding an\n" +
    "/// incompatible shape (MS041).\n" +
    `public let EXPECTED_SCHEMA_VERSION = "${version}"\n`
  );
}

const output = render(SCHEMA_VERSION);

if (values.check) {
  const current = fs.existsSync(SWIFT_OUT)
    ? fs.readFileSync(SWIFT_OUT, "utf8")
    : "";
  const inSync = current === output;
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "schema-version-codegen-sync",
        status: inSync ? "ok" : "fail",
        trapId: "MS041",
        summary: inSync
          ? "MobileSurfacesSchemaVersion.swift is in sync with version.ts."
          : "MobileSurfacesSchemaVersion.swift is out of sync with version.ts.",
        ...(inSync
          ? {}
          : {
              detail: {
                message:
                  "Run: node --experimental-strip-types scripts/generate-schema-version.mjs",
                issues: [
                  {
                    path: path.relative(process.cwd(), SWIFT_OUT),
                    message: "out of sync with packages/surface-contracts/src/version.ts",
                  },
                ],
              },
            }),
      },
    ]),
    { json: values.json },
  );
} else {
  fs.mkdirSync(path.dirname(SWIFT_OUT), { recursive: true });
  fs.writeFileSync(SWIFT_OUT, output);
  const wrote = path.relative(process.cwd(), SWIFT_OUT);
  if (values.json) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        { id: "schema-version-codegen-write", status: "ok", summary: `Wrote ${wrote}.` },
      ]),
      { json: true },
    );
  } else {
    console.log(`Wrote ${wrote}.`);
  }
}
