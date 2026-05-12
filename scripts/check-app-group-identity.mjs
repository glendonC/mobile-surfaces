#!/usr/bin/env node
// Enforces MS013: the App Group identifier must match across every place it
// is declared. Five locations are checked:
//
//   apps/mobile/app.json
//     Host app entitlement (com.apple.security.application-groups). This is
//     the canonical source — every other location must match it.
//
//   apps/mobile/targets/widget/generated.entitlements
//     Widget extension entitlement file referenced by the generated Xcode
//     project's CODE_SIGN_ENTITLEMENTS build setting. Written by
//     @bacons/apple-targets at prebuild time, but committed for the CLI
//     template ship and read directly by Xcode if prebuild is skipped.
//
//   apps/mobile/targets/widget/_shared/MobileSurfacesSharedState.swift
//     Swift constant used by every widget (Live Activity, home, control,
//     lock accessory, standby) to read shared state from
//     UserDefaults(suiteName: ...).
//
//   apps/mobile/src/surfaceStorage/index.ts
//     TS constant used by the host app to write shared state through the
//     @bacons/apple-targets ExtensionStorage helper.
//
//   apps/mobile/src/diagnostics/checkSetup.ts
//     TS constant used by the in-app diagnostic that probes whether the
//     App Group container is reachable.
//
// expo-target.config.js inherits the host's entitlements at materialization
// time, so it isn't a separate drift point and isn't checked here.
//
// MS013's failure mode is silent — a mismatched identifier means widgets
// render placeholder forever and the in-app diagnostic returns "ok"
// against a different container than the widgets are reading.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-app-group-identity";
const APP_JSON = path.resolve("apps/mobile/app.json");
const WIDGET_ENTITLEMENTS = path.resolve(
  "apps/mobile/targets/widget/generated.entitlements",
);
const SHARED_STATE_SWIFT = path.resolve(
  "apps/mobile/targets/widget/_shared/MobileSurfacesSharedState.swift",
);
const SURFACE_STORAGE_TS = path.resolve(
  "apps/mobile/src/surfaceStorage/index.ts",
);
const CHECK_SETUP_TS = path.resolve("apps/mobile/src/diagnostics/checkSetup.ts");

const sources = [
  { label: "app.json (host entitlements)", file: APP_JSON, extract: extractFromAppJson },
  { label: "widget generated.entitlements", file: WIDGET_ENTITLEMENTS, extract: extractFromWidgetEntitlements },
  { label: "MobileSurfacesSharedState.swift", file: SHARED_STATE_SWIFT, extract: extractFromSharedStateSwift },
  { label: "surfaceStorage/index.ts", file: SURFACE_STORAGE_TS, extract: extractFromTsConstant },
  { label: "diagnostics/checkSetup.ts", file: CHECK_SETUP_TS, extract: extractFromTsConstant },
];

const findings = [];
for (const source of sources) {
  if (!fs.existsSync(source.file)) {
    findings.push({
      label: source.label,
      file: source.file,
      identifier: null,
      error: "file not found",
    });
    continue;
  }
  try {
    const id = source.extract(fs.readFileSync(source.file, "utf8"));
    findings.push({
      label: source.label,
      file: source.file,
      identifier: id,
      error: id ? null : "no app-group identifier parsed",
    });
  } catch (err) {
    findings.push({
      label: source.label,
      file: source.file,
      identifier: null,
      error: err.message,
    });
  }
}

const parseErrors = findings.filter((f) => f.error);
const canonical = findings.find((f) => f.label.startsWith("app.json"))?.identifier;
const mismatches =
  canonical && parseErrors.length === 0
    ? findings.filter((f) => f.identifier !== canonical)
    : [];

const checks = [];

checks.push({
  id: "app-group-sources-readable",
  status: parseErrors.length === 0 ? "ok" : "fail",
  summary:
    parseErrors.length === 0
      ? `Parsed App Group identifier from all ${findings.length} source(s).`
      : `${parseErrors.length} source(s) failed to parse.`,
  ...(parseErrors.length > 0
    ? {
        detail: {
          message:
            "Every source must declare a parseable App Group identifier. Inspect each failing file.",
          issues: parseErrors.map((f) => ({
            path: path.relative(process.cwd(), f.file),
            message: f.error,
          })),
        },
      }
    : {}),
});

checks.push({
  id: "app-group-identity-match",
  status: parseErrors.length > 0
    ? "fail"
    : mismatches.length === 0
      ? "ok"
      : "fail",
  summary:
    parseErrors.length > 0
      ? "Skipped: one or more sources failed to parse."
      : mismatches.length === 0
        ? `All ${findings.length} sources resolve to "${canonical}".`
        : `${mismatches.length} source(s) declare a different App Group than the host app.`,
  trapId: "MS013",
  ...(mismatches.length > 0
    ? {
        detail: {
          message: `Canonical identifier from app.json is "${canonical}". Update the divergent file(s) or run \`pnpm surface:rename\` to propagate a rename across every source.`,
          issues: mismatches.map((f) => ({
            path: path.relative(process.cwd(), f.file),
            message: `${f.label} declares "${f.identifier}"`,
          })),
        },
      }
    : {}),
});

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });

function extractFromAppJson(src) {
  const json = JSON.parse(src);
  const groups =
    json?.expo?.ios?.entitlements?.["com.apple.security.application-groups"];
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error(
      "expo.ios.entitlements['com.apple.security.application-groups'] missing or empty",
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

function extractFromWidgetEntitlements(src) {
  // The plist is small and structurally predictable; a regex on the array
  // contents is more robust than pulling in a plist parser dependency.
  const match = src.match(
    /<key>com\.apple\.security\.application-groups<\/key>\s*<array>\s*<string>([^<]+)<\/string>/,
  );
  if (!match) throw new Error("application-groups <string> entry not found");
  return match[1].trim();
}

function extractFromSharedStateSwift(src) {
  // `static let appGroup = "group.com.example.mobilesurfaces"` — the
  // identifier is the only string literal assigned to the `appGroup`
  // constant in this file.
  const match = src.match(/static\s+let\s+appGroup\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("`static let appGroup` declaration not found");
  return match[1];
}

function extractFromTsConstant(src) {
  // Matches `const APP_GROUP = "group...";` exactly — both TS files use the
  // same identifier name and `const` form.
  const match = src.match(/const\s+APP_GROUP\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("`const APP_GROUP = \"...\"` declaration not found");
  return match[1];
}
