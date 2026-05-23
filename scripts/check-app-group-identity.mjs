#!/usr/bin/env node
// Enforces MS013: the App Group identifier must match across every place it
// is declared. After v5 the layout was pared down to four sources, with the
// Swift and TS const-bearing files generated from app.json by
// generate-app-group-constants.mjs (so two of the four are auto-aligned):
//
//   apps/mobile/app.json
//     Host app entitlement (com.apple.security.application-groups). This is
//     the canonical source - every other location must match it. The
//     codegen script reads from here.
//
//   apps/mobile/targets/widget/generated.entitlements
//     Widget extension entitlement file referenced by the generated Xcode
//     project's CODE_SIGN_ENTITLEMENTS build setting. Written by
//     @bacons/apple-targets at prebuild time, but committed for the CLI
//     template ship and read directly by Xcode if prebuild is skipped.
//
//   apps/mobile/targets/_shared/MobileSurfacesAppGroup.swift
//     Generated. enum MobileSurfacesAppGroup { static let identifier = "..." }.
//     The only Swift parse target; MobileSurfacesSharedState.swift now
//     references this constant rather than inlining the literal.
//
//   apps/mobile/src/generated/appGroup.ts
//     Generated. export const APP_GROUP = "..." as const. The only TS parse
//     target; surfaceStorage/index.ts and diagnostics/checkSetup.ts now
//     import this constant.
//
// expo-target.config.js inherits the host's entitlements at materialization
// time, so it isn't a separate drift point and isn't checked here.
//
// MS013's failure mode is silent - a mismatched identifier means widgets
// render placeholder forever and the in-app diagnostic returns "ok"
// against a different container than the widgets are reading.
//
// Phase 6 (refactor/v7): exposes a rootDir-parameterised core function so
// `pnpm surface:audit` can run the same check against a foreign project.
// CLI behavior preserved when invoked without --root.
//
// Two modes:
//   check  (default) — the Mobile Surfaces monorepo self-check. Every source
//                      is at its fixed apps/mobile/ path and the generated
//                      Swift/TS/entitlements files are required; their absence
//                      means codegen was not run.
//   audit            — a foreign Expo project pointed at by `surface:audit`.
//                      The Expo app directory is discovered (app.json may sit
//                      at the project root, not under apps/mobile/), and the
//                      Mobile-Surfaces-specific generated files are optional:
//                      a project that has not adopted Mobile Surfaces will not
//                      carry them, and their absence is not an MS013 mismatch.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";
import {
  discoverAppConfig,
  loadAppJson,
  readAppGroups,
} from "./lib/app-config.mjs";

const TOOL = "check-app-group-identity";

// A source that is optional in the active mode is included only when its file
// exists; its absence then carries no finding. A non-optional source is always
// included, so a missing file surfaces as a `file not found` parse failure.
function pickSource(source, optional) {
  if (optional && !fs.existsSync(source.file)) return [];
  return [source];
}

/**
 * Verify App Group identifier identity across every source under `rootDir`.
 * Returns a DiagnosticReport; the caller renders it.
 *
 * @param {{ rootDir?: string, mode?: "check" | "audit" }} [options]
 */
export function checkAppGroupIdentity({
  rootDir = process.cwd(),
  mode = "check",
} = {}) {
  const root = path.resolve(rootDir);
  const audit = mode === "audit";

  // Resolve the directory that holds app.json. Check mode uses the fixed
  // monorepo path; audit mode discovers it so a foreign Expo project is
  // handled instead of false-failing against a hard-coded apps/mobile path.
  let appJsonPath;
  let mobileRoot;
  if (audit) {
    const discovered = discoverAppConfig(root);
    if (!discovered.found) {
      return buildReport(TOOL, [
        {
          id: "app-group-sources-readable",
          status: "fail",
          summary: `No Expo app config found under ${root}.`,
          detail: {
            message:
              "surface:audit could not locate an app.json or app.config.json at the project root, apps/mobile/, or apps/*/. Point --root at an Expo project.",
          },
        },
      ]);
    }
    appJsonPath = discovered.appJsonPath;
    mobileRoot = discovered.mobileRoot;
  } else {
    mobileRoot = path.join(root, "apps/mobile");
    appJsonPath = path.join(mobileRoot, "app.json");
  }

  // In audit mode, a foreign project that declares no App Group at all is not
  // an MS013 violation: MS013 is about identity *across* sources, and whether
  // an App Group should be declared at all is probe-app-config's call.
  if (audit) {
    const loaded = loadAppJson(appJsonPath);
    if (loaded.status === "invalid") {
      return buildReport(TOOL, [
        {
          id: "app-group-sources-readable",
          status: "fail",
          summary: `${path.relative(root, appJsonPath)} could not be parsed as JSON.`,
          detail: { message: loaded.error },
        },
      ]);
    }
    if (loaded.status === "ok" && !readAppGroups(loaded.appJson).declared) {
      return buildReport(TOOL, [
        {
          id: "app-group-identity-match",
          status: "ok",
          summary:
            "No App Group declared in app.json; MS013 cross-source identity is not applicable.",
          trapId: "MS013",
        },
      ]);
    }
  }

  const WIDGET_ENTITLEMENTS = path.join(
    mobileRoot,
    "targets/widget/generated.entitlements",
  );
  const NOTIFICATION_CONTENT_ENTITLEMENTS = path.join(
    mobileRoot,
    "targets/notification-content/generated.entitlements",
  );
  const APP_GROUP_SWIFT = path.join(
    mobileRoot,
    "targets/_shared/MobileSurfacesAppGroup.swift",
  );
  const APP_GROUP_TS = path.join(mobileRoot, "src/generated/appGroup.ts");

  // app.json is always required. The widget entitlements, the generated Swift
  // constant and the generated TS constant are required in check mode and
  // optional in audit mode. The notification-content entitlements file is
  // optional in both modes (not every layout has adopted that surface).
  const sources = [
    {
      label: "app.json (host entitlements)",
      file: appJsonPath,
      extract: extractFromAppJson,
    },
    ...pickSource(
      {
        label: "widget generated.entitlements",
        file: WIDGET_ENTITLEMENTS,
        extract: extractFromWidgetEntitlements,
      },
      audit,
    ),
    ...pickSource(
      {
        label: "notification-content generated.entitlements",
        file: NOTIFICATION_CONTENT_ENTITLEMENTS,
        extract: extractFromWidgetEntitlements,
      },
      true,
    ),
    ...pickSource(
      {
        label: "MobileSurfacesAppGroup.swift",
        file: APP_GROUP_SWIFT,
        extract: extractFromAppGroupSwift,
      },
      audit,
    ),
    ...pickSource(
      {
        label: "generated/appGroup.ts",
        file: APP_GROUP_TS,
        extract: extractFromTsConstant,
      },
      audit,
    ),
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
              "Every source must declare a parseable App Group identifier. Inspect each failing file. The Swift/TS sources are generated by `pnpm surface:codegen` from app.json.",
            issues: parseErrors.map((f) => ({
              path: path.relative(root, f.file),
              message: f.error,
            })),
          },
        }
      : {}),
  });

  checks.push({
    id: "app-group-identity-match",
    status:
      parseErrors.length > 0
        ? "fail"
        : mismatches.length === 0
          ? "ok"
          : "fail",
    summary:
      parseErrors.length > 0
        ? "Skipped: one or more sources failed to parse."
        : mismatches.length === 0
          ? findings.length === 1
            ? `Only app.json declares an App Group ("${canonical}"); no other source to cross-check.`
            : `All ${findings.length} sources resolve to "${canonical}".`
          : `${mismatches.length} source(s) declare a different App Group than the host app.`,
    trapId: "MS013",
    ...(mismatches.length > 0
      ? {
          detail: {
            message: `Canonical identifier from app.json is "${canonical}". Update app.json and re-run \`pnpm surface:codegen\` to regenerate the Swift and TS constants, or run \`pnpm surface:rename\` to propagate a rename across every source.`,
            issues: mismatches.map((f) => ({
              path: path.relative(root, f.file),
              message: `${f.label} declares "${f.identifier}"`,
            })),
          },
        }
      : {}),
  });

  return buildReport(TOOL, checks);
}

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
  //
  // Enumerate every <string> inside the application-groups <array> so a
  // misconfigured plist with two groups cannot silently collapse to its
  // first entry. extractFromAppJson rejects length != 1 on the same gate;
  // the two extractors must agree on what "the App Group" means.
  const arrayMatch = src.match(
    /<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (!arrayMatch) {
    throw new Error("application-groups <array> not found");
  }
  const groups = [];
  const stringRe = /<string>([^<]*)<\/string>/g;
  let m;
  while ((m = stringRe.exec(arrayMatch[1])) !== null) {
    groups.push(m[1].trim());
  }
  if (groups.length === 0) {
    throw new Error("application-groups <array> contains no <string> entries");
  }
  if (groups.length > 1) {
    throw new Error(
      `expected exactly one App Group, found ${groups.length}: ${groups.join(", ")}`,
    );
  }
  if (!groups[0]) {
    throw new Error("App Group <string> entry is empty");
  }
  return groups[0];
}

function extractFromAppGroupSwift(src) {
  // The generated Swift file declares:
  //   enum MobileSurfacesAppGroup {
  //     static let identifier = "..."
  //   }
  const match = src.match(/static\s+let\s+identifier\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(
      "`static let identifier` declaration not found in MobileSurfacesAppGroup.swift",
    );
  }
  return match[1];
}

function extractFromTsConstant(src) {
  // The generated TS file declares: export const APP_GROUP = "..." as const;
  const match = src.match(/const\s+APP_GROUP\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("`const APP_GROUP = \"...\"` declaration not found");
  return match[1];
}

// CLI entrypoint. The `cwd` defaulting preserves prior behavior for the
// `pnpm surface:check` invocation (which spawns this script from the repo
// root) and the existing tests (which spawn with cwd set to a tmp dir).
const isDirectInvocation =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectInvocation) {
  const { values } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      root: { type: "string" },
      mode: { type: "string", default: "check" },
    },
  });
  const report = checkAppGroupIdentity({
    rootDir: values.root ?? process.cwd(),
    mode: values.mode === "audit" ? "audit" : "check",
  });
  emitDiagnosticReport(report, { json: values.json });
}
