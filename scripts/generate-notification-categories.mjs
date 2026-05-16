#!/usr/bin/env node
// Codegen for the notification-categories registry. Source of truth:
//   packages/surface-contracts/src/notificationCategories.ts
//
// Writes three derived artifacts:
//
// 1. apps/mobile/src/generated/notificationCategories.ts
//    Host-side TS constant. The notifications module imports this and feeds
//    it to UNUserNotificationCenter.setNotificationCategoriesAsync at app
//    launch. Hand-written code never inlines a category id literal.
//
// 2. apps/mobile/targets/_shared/MobileSurfacesNotificationCategories.swift
//    Swift constant. The notification-content extension's
//    NSExtensionAttributes.UNNotificationExtensionCategory key references
//    these via the Info.plist template the extension target ships; in-Swift
//    code that routes on category id reads from this constant rather than
//    hard-coding a string literal.
//
// 3. apps/mobile/targets/notification-content/Info.plist
//    Optional: when the extension target's Info.plist exists, the
//    UNNotificationExtensionCategory array is updated in place to match the
//    canonical registry. When the file does not yet exist (the extension
//    target lands in Phase 4 of the v5 refactor), the codegen skips this
//    output gracefully so Phase 3 of the refactor can land independently.
//
// Pass --check to compare on-disk against the regenerated output and exit
// non-zero on drift (mirrors scripts/build-schema.mjs --check). Wired into
// scripts/lib/check-registry.mjs at trapId MS037 so a hand edit to any of
// the generated files fails the stage-2 drift gate.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import { NOTIFICATION_CATEGORIES } from "../packages/surface-contracts/src/notificationCategories.ts";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const TOOL = "generate-notification-categories";

const TS_OUT = resolve("apps/mobile/src/generated/notificationCategories.ts");
const SWIFT_OUT = resolve(
  "apps/mobile/targets/_shared/MobileSurfacesNotificationCategories.swift",
);
const PLIST_OUT = resolve(
  "apps/mobile/targets/notification-content/Info.plist",
);

const HEADER_LINE_1 =
  "// GENERATED - DO NOT EDIT. Source: packages/surface-contracts/src/notificationCategories.ts.";
const HEADER_LINE_2 = "// Regenerate: pnpm surface:codegen";

const tsBody = renderTs();
const swiftBody = renderSwift();
const plistUpdate = computePlistUpdate();

const targets = [
  { label: "TS const", path: TS_OUT, contents: tsBody },
  { label: "Swift const", path: SWIFT_OUT, contents: swiftBody },
];

if (values.check) {
  const drifts = [];
  for (const target of targets) {
    const current = existsSync(target.path) ? readFileSync(target.path, "utf8") : null;
    if (current !== target.contents) {
      drifts.push({ path: target.path, label: target.label });
    }
  }
  if (plistUpdate.applicable && plistUpdate.drift) {
    drifts.push({ path: PLIST_OUT, label: "extension Info.plist UNNotificationExtensionCategory" });
  }
  emitDiagnosticReport(
    buildReport(TOOL, [
      {
        id: "notification-categories-sync",
        status: drifts.length === 0 ? "ok" : "fail",
        summary:
          drifts.length === 0
            ? `Notification category outputs are in sync (${targets.length} files${plistUpdate.applicable ? " + extension Info.plist" : ""}).`
            : `${drifts.length} notification-category output(s) out of sync.`,
        trapId: "MS037",
        ...(drifts.length > 0
          ? {
              detail: {
                message:
                  "The canonical source is packages/surface-contracts/src/notificationCategories.ts. Edit it and run pnpm surface:codegen. The generated files revert on the next codegen run.",
                issues: drifts.map((d) => ({
                  path: d.path,
                  message: `${d.label} drifted from canonical`,
                })),
              },
            }
          : {}),
      },
    ]),
    { json: values.json },
  );
} else {
  for (const target of targets) {
    mkdirSync(dirname(target.path), { recursive: true });
    writeFileSync(target.path, target.contents);
  }
  if (plistUpdate.applicable && plistUpdate.drift) {
    writeFileSync(PLIST_OUT, plistUpdate.next);
  }
  const written = targets.map((t) => t.path);
  if (plistUpdate.applicable && plistUpdate.drift) written.push(PLIST_OUT);
  if (values.json) {
    emitDiagnosticReport(
      buildReport(TOOL, [
        {
          id: "notification-categories-write",
          status: "ok",
          summary: `Wrote ${written.length} notification-category output(s).`,
        },
      ]),
      { json: true },
    );
  } else {
    for (const p of written) {
      console.log(`Wrote ${p.replace(`${process.cwd()}/`, "")}.`);
    }
  }
}

// ---------- Renderers ----------

function renderTs() {
  const lines = [
    HEADER_LINE_1,
    HEADER_LINE_2,
    "",
    "// Mirror of NOTIFICATION_CATEGORIES from the canonical TS source, in a",
    "// host-importable shape. The notifications module passes this directly",
    "// into UNUserNotificationCenter.setNotificationCategoriesAsync at app",
    "// launch so the registered set always matches the wire categories.",
    "export type NotificationCategoryActionOptions = {",
    "  foreground?: boolean;",
    "  destructive?: boolean;",
    "  authenticationRequired?: boolean;",
    "};",
    "",
    "export type NotificationCategoryAction = {",
    "  id: string;",
    "  title: string;",
    "  options?: NotificationCategoryActionOptions;",
    "};",
    "",
    "export type NotificationCategory = {",
    "  id: string;",
    "  actions: readonly NotificationCategoryAction[];",
    "};",
    "",
    "export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [",
  ];
  for (const category of NOTIFICATION_CATEGORIES.categories) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(category.id)},`);
    if (category.actions.length === 0) {
      lines.push("    actions: [],");
    } else {
      lines.push("    actions: [");
      for (const action of category.actions) {
        lines.push("      {");
        lines.push(`        id: ${JSON.stringify(action.id)},`);
        lines.push(`        title: ${JSON.stringify(action.title)},`);
        if (action.options) {
          lines.push(`        options: ${JSON.stringify(action.options)},`);
        }
        lines.push("      },");
      }
      lines.push("    ],");
    }
    lines.push("  },");
  }
  lines.push("] as const;");
  lines.push("");
  lines.push("export const NOTIFICATION_CATEGORY_IDS = NOTIFICATION_CATEGORIES.map(");
  lines.push("  (c) => c.id,");
  lines.push(") as readonly string[];");
  lines.push("");
  return lines.join("\n");
}

function renderSwift() {
  // Generate a Swift symbol name from an id by splitting on dots/hyphens/
  // underscores and camel-casing. e.g. "surface-update" -> "surfaceUpdate";
  // "app.calendar.meeting-invitation" -> "appCalendarMeetingInvitation".
  const lines = [
    HEADER_LINE_1,
    HEADER_LINE_2,
    "",
    "import Foundation",
    "",
    "/// Mirror of NOTIFICATION_CATEGORIES from the canonical TS source.",
    "/// The notification-content extension's Info.plist declares the same",
    "/// identifier strings under NSExtensionAttributes.UNNotificationExtensionCategory;",
    "/// Swift code that switches on a category id reads from this enum",
    "/// rather than hard-coding a literal so a rename via the canonical",
    "/// source propagates without drift.",
    "enum MobileSurfacesNotificationCategories {",
  ];
  for (const category of NOTIFICATION_CATEGORIES.categories) {
    const symbol = toSwiftSymbol(category.id);
    lines.push(`  static let ${symbol} = ${JSON.stringify(category.id)}`);
  }
  lines.push("");
  lines.push("  /// Flat ordered list. Mirrors the JSON array shape that the");
  lines.push("  /// extension Info.plist UNNotificationExtensionCategory key holds.");
  lines.push("  static let all: [String] = [");
  for (const category of NOTIFICATION_CATEGORIES.categories) {
    lines.push(`    ${toSwiftSymbol(category.id)},`);
  }
  lines.push("  ]");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function toSwiftSymbol(id) {
  const parts = id.split(/[.\-_]/).filter(Boolean);
  if (parts.length === 0) return "_unknown";
  const [first, ...rest] = parts;
  return (
    first.toLowerCase() +
    rest.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join("")
  );
}

function computePlistUpdate() {
  if (!existsSync(PLIST_OUT)) {
    return { applicable: false };
  }
  const current = readFileSync(PLIST_OUT, "utf8");
  const ids = NOTIFICATION_CATEGORIES.categories.map((c) => c.id);
  const desiredBlock = renderPlistCategoryBlock(ids);
  // Replace the existing UNNotificationExtensionCategory entry in place,
  // preserving everything else in the plist verbatim. Match the key and the
  // following value (which may be <string> or <array>).
  // Preserve the original indentation of the surrounding NSExtensionAttributes
  // dict so the regenerated block visually fits the file. Match the key and
  // capture the preceding whitespace; emit the array at the same indent.
  const next = current.replace(
    /([ \t]*)<key>UNNotificationExtensionCategory<\/key>\s*(<string>[^<]*<\/string>|<array>[\s\S]*?<\/array>)/,
    (_match, indent) =>
      `${indent}<key>UNNotificationExtensionCategory</key>\n${indent}${renderPlistCategoryArray(ids, indent)}`,
  );
  return {
    applicable: true,
    drift: next !== current,
    next,
  };
}

function renderPlistCategoryArray(ids, indent) {
  // One level deeper than the surrounding indent for the <string> children.
  const childIndent = indent + "  ";
  const lines = ["<array>"];
  for (const id of ids) {
    lines.push(`${childIndent}<string>${id}</string>`);
  }
  lines.push(`${indent}</array>`);
  return lines.join("\n");
}

function renderPlistCategoryBlock(ids) {
  return renderPlistCategoryArray(ids, "      ");
}
