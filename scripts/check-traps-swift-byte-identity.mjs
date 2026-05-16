#!/usr/bin/env node
// Asserts MS040: MobileSurfacesTraps.swift is byte-identical across the
// three sites that physically need a copy.
//
//   packages/traps/swift/MobileSurfacesTraps.swift           (canonical)
//   packages/live-activity/ios/MobileSurfacesTraps.swift     (native module pod)
//   apps/mobile/targets/_shared/MobileSurfacesTraps.swift    (widget + notification-content via _shared/)
//
// All three are written by scripts/generate-traps-package.mjs from
// data/traps.json. The stage-2 codegen-drift gate normally catches edits
// to the catalog without a regen; this stage-3 byte-identity check is the
// belt to that suspender: it fires if the codegen output was bypassed or
// one copy was hand-edited.
//
// Mirrors the shape of scripts/check-activity-attributes.mjs (MS002).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-traps-swift-byte-identity";

const CANONICAL = path.resolve("packages/traps/swift/MobileSurfacesTraps.swift");
const REPLICAS = [
  path.resolve("packages/live-activity/ios/MobileSurfacesTraps.swift"),
  path.resolve("apps/mobile/targets/_shared/MobileSurfacesTraps.swift"),
];

const ALL_PATHS = [CANONICAL, ...REPLICAS];

const missing = ALL_PATHS.filter((p) => !fs.existsSync(p));
if (missing.length > 0) {
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "traps-swift-present",
        status: "fail",
        trapId: "MS040",
        summary: `${missing.length} of the three MobileSurfacesTraps.swift sites are missing.`,
        detail: {
          paths: missing.map((p) => path.relative(process.cwd(), p)),
          message:
            "Run pnpm surface:codegen to regenerate from data/traps.json.",
        },
      },
    ]),
    { json: values.json },
  );
}

const canonical = fs.readFileSync(CANONICAL, "utf8");
const driftedPaths = [];
for (const replica of REPLICAS) {
  const content = fs.readFileSync(replica, "utf8");
  if (content !== canonical) {
    driftedPaths.push(path.relative(process.cwd(), replica));
  }
}

const checks = [
  {
    id: "traps-swift-byte-identity",
    status: driftedPaths.length === 0 ? "ok" : "fail",
    trapId: "MS040",
    summary:
      driftedPaths.length === 0
        ? "MobileSurfacesTraps.swift is byte-identical across all three sites."
        : `${driftedPaths.length} replica${driftedPaths.length === 1 ? " has" : "s have"} drifted from the canonical copy.`,
    ...(driftedPaths.length > 0
      ? {
          detail: {
            paths: [
              path.relative(process.cwd(), CANONICAL),
              ...driftedPaths,
            ],
            message:
              "All three files are generated. Edit data/traps.json then run: pnpm surface:codegen. The stage-2 generate-traps-package --check gate normally catches this earlier; if you see this message, codegen was bypassed or one file was hand-edited.",
          },
        }
      : {}),
  },
];

emitDiagnosticReport(buildReport(TOOL, checks), { json: values.json });
