import { z } from "zod";

// The trap catalog encodes the silent-failure modes and invariants that
// make iOS Live Activity work hard to get right. It is the single source of
// truth for AGENTS.md / CLAUDE.md, the future `mobile-surfaces check` CLI,
// and any downstream MCP tooling. Adding or editing a rule here regenerates
// every consumer; nothing is hand-maintained downstream.

export const trapSeverity = z.enum(["error", "warning", "info"]);
export type TrapSeverity = z.infer<typeof trapSeverity>;

// How the rule is detectable today. `static` rules can be enforced by a
// repo-local script. `config` rules read declarative files (app.json,
// package.json, expo-target.config.js). `runtime` rules surface only at
// runtime (token env crossing, APNs response codes). `advisory` rules are
// awareness-only - they document caveats with no programmatic check.
export const trapDetection = z.enum([
  "static",
  "config",
  "runtime",
  "advisory",
]);
export type TrapDetection = z.infer<typeof trapDetection>;

export const trapTag = z.enum([
  "live-activity",
  "widget",
  "control",
  "notification",
  "push",
  "toolchain",
  "config",
  "swift",
  "contract",
  "tokens",
  "ios-version",
  "cng",
  "app-group",
  "channels",
  "ios18",
]);
export type TrapTag = z.infer<typeof trapTag>;

export const trapEntry = z
  .object({
    // MS-prefixed three-digit identifier. Stable across releases. New rules
    // append; deprecated rules keep their id and add `deprecated: true`.
    id: z.string().regex(/^MS\d{3}$/),
    title: z.string().min(1),
    severity: trapSeverity,
    detection: trapDetection,
    tags: z.array(trapTag).min(1),
    // One-sentence summary suitable for an `AGENTS.md` table row.
    summary: z.string().min(1),
    // What the developer sees when the rule is violated. Live Activity
    // failures are mostly silent, so this often reads "no error, just X
    // never happens."
    symptom: z.string().min(1),
    // Concrete fix instruction. Should be actionable in one or two steps.
    fix: z.string().min(1),
    // Minimum iOS version at which the rule applies. Omit when the rule is
    // version-independent.
    iosMin: z.string().optional(),
    // Path (relative to repo root) of the script that enforces this rule, if
    // any. Required on every `static` rule (enforced by the superRefine
    // below). Present on `config` rules that already have CI coverage; absent
    // on `advisory` and `runtime` rules.
    enforcement: z
      .object({
        script: z.string().min(1),
      })
      .strict()
      .optional(),
    // Pointers into Apple documentation when the failure mode comes from a
    // documented platform behavior (priority budgets, payload limits, etc.).
    appleDocs: z.array(z.url()).optional(),
    // Pointers into local docs/ for deeper context.
    docs: z.array(z.string().min(1)).optional(),
    // Schema version of this catalog at which the rule was introduced. Lets
    // us evolve the rule set without breaking pinned consumers.
    since: z.string().regex(/^\d+\.\d+\.\d+$/),
    // Set when the rule has been retired but the id is reserved.
    deprecated: z.boolean().optional(),
    // Names of typed error classes (in `@mobile-surfaces/push`) that surface
    // this trap at runtime. Lets the SDK stamp `trapId` on errors without
    // hand-maintaining a parallel mapping; lets consumer log aggregators
    // bucket by trap. The forward direction (cited classes exist) and
    // uniqueness (one class → at most one trap) are enforced by
    // scripts/check-trap-error-binding.mjs. The reverse direction is
    // intentionally not strict: not every error class warrants a catalog
    // entry (e.g. BadPriority, MissingTopic are SDK self-correctness issues,
    // not silent-failure traps).
    errorClasses: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type TrapEntry = z.infer<typeof trapEntry>;

export const trapCatalog = z
  .object({
    schemaVersion: z.literal("1"),
    entries: z.array(trapEntry),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    const errorClassToTrap = new Map<string, string>();
    catalog.entries.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "id"],
          message: `Duplicate rule id: ${entry.id}`,
        });
      }
      seen.add(entry.id);
      // `static` rules are script-checkable by definition, so every one must
      // cite the script that enforces it. Without this, a static rule could
      // ship with no CI coverage and silently rot. `config` rules are also
      // often enforced but not always (some are declarative-only audits), so
      // they are left optional.
      if (entry.detection === "static" && !entry.enforcement) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "enforcement"],
          message: `Rule ${entry.id} has detection "static" but no enforcement.script; static rules must cite an enforcer.`,
        });
      }
      if (entry.errorClasses) {
        entry.errorClasses.forEach((className, classIndex) => {
          const existing = errorClassToTrap.get(className);
          if (existing && existing !== entry.id) {
            ctx.addIssue({
              code: "custom",
              path: ["entries", index, "errorClasses", classIndex],
              message: `Error class ${className} is already bound to ${existing}; each class may be cited by at most one trap.`,
            });
          }
          errorClassToTrap.set(className, entry.id);
        });
      }
    });
  });
export type TrapCatalog = z.infer<typeof trapCatalog>;
