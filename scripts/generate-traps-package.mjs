#!/usr/bin/env node
// Single generator for @mobile-surfaces/traps. Reads data/traps.json (the
// canonical catalog) and writes three outputs:
//
//   1. packages/traps/src/generated/bindings.ts
//        TS table consumed by the lookup helpers + MobileSurfacesError
//        getters. Includes every catalog entry (deprecated ones too) so
//        the renderer's retired-ids section can resolve them.
//   2. packages/traps/swift/MobileSurfacesTraps.swift
//        Swift MSTraps lookup table + MSTrapBound protocol. The canonical
//        source.
//   3. packages/live-activity/ios/MobileSurfacesTraps.swift
//   4. apps/mobile/targets/_shared/MobileSurfacesTraps.swift
//        Byte-identity replicas of (2). The replication is intentional
//        (mirrors the MS002 attribute-file pattern): the native-module pod
//        and the _shared/ widget+notification-content auto-membership
//        convention each need their own physical copy, but no consumer
//        ever edits any copy by hand. MS040 enforces byte-identity.
//
// Replaces the older split generators (generate-trap-bindings.mjs writing
// packages/push/src/trap-bindings.ts and generate-traps-data.mjs writing
// packages/surface-contracts/src/traps-data.ts). Both old files were
// internal exports; we delete them in this phase and have all consumers
// import from @mobile-surfaces/traps directly.
//
// Run plain: regenerate. Run with --check: verify the four committed
// files match the generator output. CI guard wired into surface-check.
// Deliberately deps-free at the module level: no zod, no surface-contracts.
// This generator must run pre-install (rename-starter invokes it in a freshly
// extracted scaffold tarball before `pnpm install`), so importing anything
// from a workspace package would crash because the symlink chain isn't there
// yet. data/traps.json's shape is validated separately by validate-trap
// -catalog.mjs (which DOES import the Zod schema). The generator trusts the
// catalog format; a malformed catalog would fail that gate, not this one.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const TOOL = "generate-traps-package";
const TRAPS_PATH = resolve("data/traps.json");

const TS_OUT = resolve("packages/traps/src/generated/bindings.ts");
const SWIFT_CANONICAL = resolve("packages/traps/swift/MobileSurfacesTraps.swift");
const SWIFT_REPLICA_LIVE_ACTIVITY = resolve(
  "packages/live-activity/ios/MobileSurfacesTraps.swift",
);
const SWIFT_REPLICA_SHARED = resolve(
  "apps/mobile/targets/_shared/MobileSurfacesTraps.swift",
);

const DOCS_BASE_URL =
  "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md";

const raw = readFileSync(TRAPS_PATH, "utf8");
const parsed = JSON.parse(raw);
// Shape validation lives in validate-trap-catalog.mjs (the surface:check
// gate that imports the Zod schema). Here we trust the catalog format so
// the generator can run pre-install in a freshly extracted scaffold.
const entries = [...parsed.entries].sort((a, b) => a.id.localeCompare(b.id));

// Forward map: every cited error class -> trap id. Uniqueness is enforced
// by the Zod superRefine in traps.ts; the iteration is order-stable
// because we sort the entries by id first.
const errorClassToTrapId = [];
for (const entry of entries) {
  if (!entry.errorClasses) continue;
  for (const className of entry.errorClasses) {
    errorClassToTrapId.push({ className, trapId: entry.id });
  }
}
errorClassToTrapId.sort((a, b) => a.className.localeCompare(b.className));

const tsOut = renderTs(entries, errorClassToTrapId);
const swiftOut = renderSwift(entries, errorClassToTrapId);

const targets = [
  { path: TS_OUT, content: tsOut },
  { path: SWIFT_CANONICAL, content: swiftOut },
  { path: SWIFT_REPLICA_LIVE_ACTIVITY, content: swiftOut },
  { path: SWIFT_REPLICA_SHARED, content: swiftOut },
];

if (values.check) {
  const driftedPaths = [];
  for (const { path: out, content } of targets) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current !== content) {
      driftedPaths.push(relative(process.cwd(), out));
    }
  }
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "traps-package-sync",
        status: driftedPaths.length === 0 ? "ok" : "fail",
        summary:
          driftedPaths.length === 0
            ? "@mobile-surfaces/traps bindings and Swift replicas are in sync with data/traps.json."
            : `${driftedPaths.length} generated file${driftedPaths.length === 1 ? " is" : "s are"} out of sync with data/traps.json.`,
        ...(driftedPaths.length > 0
          ? {
              detail: {
                paths: driftedPaths,
                message:
                  "Run: node --experimental-strip-types scripts/generate-traps-package.mjs",
              },
            }
          : {}),
      },
    ]),
    { json: values.json },
  );
} else {
  for (const { path: out, content } of targets) {
    writeFileSync(out, content);
  }
  if (values.json) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "traps-package-write",
          status: "ok",
          summary: `Wrote ${targets.length} files for @mobile-surfaces/traps.`,
          detail: {
            paths: targets.map((t) => relative(process.cwd(), t.path)),
          },
        },
      ]),
      { json: true },
    );
  } else {
    for (const { path: out } of targets) {
      console.log(`Wrote ${relative(process.cwd(), out)}.`);
    }
  }
}

function githubAnchor(heading) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function docsUrlFor(id, title) {
  return `${DOCS_BASE_URL}#${githubAnchor(`${id}: ${title}`)}`;
}

function tsLit(s) {
  return JSON.stringify(s);
}

function renderTs(entries, errorMap) {
  const trapIdsLines = entries
    .filter((e) => !e.deprecated)
    .map((e) => `  ${e.id}: "${e.id}",`)
    .join("\n");

  const errorMapLines = errorMap
    .map(({ className, trapId }) => `  ${className}: "${trapId}",`)
    .join("\n");

  const bindingEntries = entries
    .map((entry) => {
      const fields = [
        `      id: "${entry.id}"`,
        `      title: ${tsLit(entry.title)}`,
        `      severity: "${entry.severity}"`,
        `      detection: "${entry.detection}"`,
        `      summary: ${tsLit(entry.summary)}`,
        `      symptom: ${tsLit(entry.symptom)}`,
        `      fix: ${tsLit(entry.fix)}`,
        `      docsUrl: "${docsUrlFor(entry.id, entry.title)}"`,
      ];
      if (entry.deprecated) fields.push(`      deprecated: true`);
      if (entry.siblings && entry.siblings.length > 0) {
        const list = entry.siblings.map((id) => `"${id}"`).join(", ");
        fields.push(`      siblings: [${list}] as const`);
      }
      if (entry.errorClasses && entry.errorClasses.length > 0) {
        const list = entry.errorClasses.map((c) => tsLit(c)).join(", ");
        fields.push(`      errorClasses: [${list}] as const`);
      }
      return `    [\n      "${entry.id}",\n      {\n${fields.join(",\n")},\n      },\n    ],`;
    })
    .join("\n");

  return `// GENERATED - DO NOT EDIT.
// Source: data/traps.json. Regenerate: pnpm surface:codegen.
//
// Consumed by packages/traps/src/index.ts. External code imports from
// @mobile-surfaces/traps, never from this file directly.

import type { TrapBinding, TrapId } from "../index.ts";

export const TrapIds = {
${trapIdsLines}
} as const satisfies Record<string, TrapId>;

export const ERROR_CLASS_TO_TRAP_ID: Record<string, TrapId> = {
${errorMapLines}
};

export const TRAP_BINDINGS: ReadonlyMap<TrapId, TrapBinding> = new Map<
  TrapId,
  TrapBinding
>([
${bindingEntries}
]);
`;
}

function swiftLit(s) {
  // Swift string literal escapes: backslash, double quote, newline,
  // carriage return, tab, NUL. The catalog prose is plain ASCII (the
  // schema enforces this elsewhere), but encode defensively so future
  // entries with unicode or punctuation don't break the codegen.
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(/\0/g, "\\0") +
    '"'
  );
}

function renderSwift(entries, errorMap) {
  const allEntries = entries
    .map((entry) => {
      const docsUrl = docsUrlFor(entry.id, entry.title);
      return `    "${entry.id}": MSTrapBinding(
      id: "${entry.id}",
      title: ${swiftLit(entry.title)},
      severity: "${entry.severity}",
      detection: "${entry.detection}",
      summary: ${swiftLit(entry.summary)},
      symptom: ${swiftLit(entry.symptom)},
      fix: ${swiftLit(entry.fix)},
      docsUrl: "${docsUrl}"
    )`;
    })
    .join(",\n");

  const byCase = errorMap
    .map(({ className, trapId }) => `    "${className}": "${trapId}"`)
    .join(",\n");

  return `// GENERATED - DO NOT EDIT.
// Source: data/traps.json. Regenerate: pnpm surface:codegen.
//
// Byte-identity replicated into three sites (MS040):
//   packages/traps/swift/MobileSurfacesTraps.swift           (canonical)
//   packages/live-activity/ios/MobileSurfacesTraps.swift     (native module pod)
//   apps/mobile/targets/_shared/MobileSurfacesTraps.swift    (widget + notification-content via _shared/)

import Foundation

public protocol MSTrapBound: Error {
  var trapId: String? { get }
  var docsUrl: String? { get }
}

public struct MSTrapBinding: Sendable {
  public let id: String
  public let title: String
  public let severity: String
  public let detection: String
  public let summary: String
  public let symptom: String
  public let fix: String
  public let docsUrl: String
}

public enum MSTraps {
  public static let all: [String: MSTrapBinding] = [
${allEntries}
  ]

  public static let byErrorCase: [String: String] = [
${byCase}
  ]

  public static func find(_ id: String) -> MSTrapBinding? { all[id] }

  public static func find(forCase name: String) -> MSTrapBinding? {
    byErrorCase[name].flatMap { all[$0] }
  }
}

public extension MSTrapBound {
  var trapId: String? { MSTraps.byErrorCase[String(describing: self)] }
  var docsUrl: String? {
    MSTraps.find(forCase: String(describing: self))?.docsUrl
  }
}
`;
}
