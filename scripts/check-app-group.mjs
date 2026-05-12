#!/usr/bin/env node
// Verify the App Group identifier matches across the four sites that need to
// agree (MS013). app.json is the source of truth — `pnpm surface:rename`
// rewrites every site at once, but a manual edit that touches only one or two
// causes the widget/host App Group containers to diverge silently:
//
//   1. apps/mobile/app.json
//        expo.ios.entitlements["com.apple.security.application-groups"]
//   2. apps/mobile/ios/MobileSurfaces/MobileSurfaces.entitlements (CNG-managed
//      from app.json; checked anyway in case prebuild was skipped)
//   3. apps/mobile/targets/widget/generated.entitlements (materialized by
//      @bacons/apple-targets)
//   4. apps/mobile/targets/widget/_shared/MobileSurfacesSharedState.swift
//        (the Swift constant the widget extension reads from at runtime)
//
// TS-side references (apps/mobile/src/surfaceStorage/index.ts and
// apps/mobile/src/diagnostics/checkSetup.ts) follow the same constant and are
// checked too.
//
// Pass --json to emit a DiagnosticReport.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-app-group";
const checks = [];

const appJsonPath = path.resolve("apps/mobile/app.json");
const hostEntitlementsPath = path.resolve(
  "apps/mobile/ios/MobileSurfaces/MobileSurfaces.entitlements",
);
const widgetEntitlementsPath = path.resolve(
  "apps/mobile/targets/widget/generated.entitlements",
);
const widgetSwiftPath = path.resolve(
  "apps/mobile/targets/widget/_shared/MobileSurfacesSharedState.swift",
);
const surfaceStoragePath = path.resolve("apps/mobile/src/surfaceStorage/index.ts");
const diagnosticsPath = path.resolve("apps/mobile/src/diagnostics/checkSetup.ts");

// Read app.json — the canonical source.
const appJsonRaw = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
const appJsonGroups =
  appJsonRaw?.expo?.ios?.entitlements?.["com.apple.security.application-groups"];
if (!Array.isArray(appJsonGroups) || appJsonGroups.length === 0) {
  checks.push({
    id: "app-json-source",
    status: "fail",
    trapId: "MS013",
    summary:
      "app.json: expo.ios.entitlements['com.apple.security.application-groups'] is missing or empty.",
    detail: { message: "App Group must be declared in app.json. See MS013." },
  });
  emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
}

const canonical = appJsonGroups[0];
checks.push({
  id: "app-json-source",
  status: "ok",
  trapId: "MS013",
  summary: `app.json declares App Group "${canonical}".`,
});

// Helper: assert a file contains the canonical identifier.
function checkFile(label, filePath, opts = {}) {
  if (!fs.existsSync(filePath)) {
    if (opts.optional) {
      checks.push({
        id: label,
        status: "ok",
        trapId: "MS013",
        summary: `${path.relative(process.cwd(), filePath)} not present; skipped.`,
      });
      return;
    }
    checks.push({
      id: label,
      status: "fail",
      trapId: "MS013",
      summary: `${path.relative(process.cwd(), filePath)} not found.`,
    });
    return;
  }
  const source = fs.readFileSync(filePath, "utf8");
  const present = source.includes(canonical);
  checks.push({
    id: label,
    status: present ? "ok" : "fail",
    trapId: "MS013",
    summary: present
      ? `${path.relative(process.cwd(), filePath)} references "${canonical}".`
      : `${path.relative(process.cwd(), filePath)} does NOT reference "${canonical}". Run pnpm surface:rename or align manually.`,
  });
}

checkFile("host-entitlements", hostEntitlementsPath, { optional: true });
checkFile("widget-entitlements", widgetEntitlementsPath, { optional: true });
checkFile("widget-swift-shared-state", widgetSwiftPath);
checkFile("ts-surface-storage", surfaceStoragePath);
checkFile("ts-diagnostics-check-setup", diagnosticsPath);

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
