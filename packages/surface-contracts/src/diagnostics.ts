import { z } from "zod";

// DiagnosticReport is the shared shape every Mobile Surfaces tool emits when
// invoked with --json. It is the data model the broader observability story
// rests on: surface:check scripts in Phase 1, the surface:diagnose bundle in
// Phase 2, future MCP tooling, and any AI assistant that needs to parse
// repo-state deterministically. Producers and consumers must agree on this
// shape; ad-hoc per-script JSON is rejected at the boundary.

export const diagnosticCheckStatus = z.enum(["ok", "warn", "fail", "skip"]);
export type DiagnosticCheckStatus = z.infer<typeof diagnosticCheckStatus>;

// "skip" is per-check only (a check that did not run because a precondition was
// not met — e.g. env var missing). The report-level rollup uses the narrower
// three-value union: a tool that produced output ran to completion.
export const diagnosticReportStatus = z.enum(["ok", "warn", "fail"]);
export type DiagnosticReportStatus = z.infer<typeof diagnosticReportStatus>;

export const diagnosticIssue = z
  .object({
    // Path into whatever artifact failed validation. For Zod issues, the
    // dotted path the issue refers to. For file-level checks, a relative
    // file path. Empty string when the issue is not addressable.
    path: z.string(),
    message: z.string().min(1),
  })
  .strict();
export type DiagnosticIssue = z.infer<typeof diagnosticIssue>;

export const diagnosticDetail = z
  .object({
    // Free-form longer description. Use when the summary cannot capture the
    // failure on its own (e.g. multi-line diff hint).
    message: z.string().optional(),
    // File paths referenced by this check. Useful for byte-identity checks,
    // adapter-boundary violations, etc. Paths are relative to repo root.
    paths: z.array(z.string()).optional(),
    // Structured per-issue list. Use when a check can fail in multiple
    // places at once (Zod parse, multi-violation imports, etc.).
    issues: z.array(diagnosticIssue).optional(),
  })
  .strict();
export type DiagnosticDetail = z.infer<typeof diagnosticDetail>;

export const diagnosticCheck = z
  .object({
    // Stable, machine-readable check identifier. Conventionally
    // kebab-case. A tool with N checks emits N entries with distinct ids.
    id: z.string().min(1),
    status: diagnosticCheckStatus,
    // One-line human-readable summary. Same string the human-output mode
    // would print. Always populated, even on "ok".
    summary: z.string().min(1),
    // Trap catalog id (MS\d{3}) when the check enforces a specific trap.
    // Lets consumers (issue templates, harness UI, AI assistants) link
    // straight to the documented fix without reverse-mapping summary text.
    trapId: z
      .string()
      .regex(/^MS\d{3}$/)
      .optional(),
    detail: diagnosticDetail.optional(),
  })
  .strict();
export type DiagnosticCheck = z.infer<typeof diagnosticCheck>;

export const diagnosticReport = z
  .object({
    // Pinned to "1". Bumps on breaking changes to this shape. Additive
    // optional fields do not require a bump; tightening or renaming does.
    schemaVersion: z.literal("1"),
    // Stable identifier of the tool that produced the report. By
    // convention, the script basename without the .mjs extension
    // ("build-schema", "check-adapter-boundary"). The surface:diagnose
    // bundle wraps many reports and will use its own identifier.
    tool: z.string().min(1),
    // ISO-8601 UTC. Use new Date().toISOString().
    timestamp: z.iso.datetime(),
    // Rolled-up status across all checks. ok = every check ok-or-skip,
    // warn = at least one warn but no fail, fail = at least one fail.
    status: diagnosticReportStatus,
    checks: z.array(diagnosticCheck).min(1),
  })
  .strict();
export type DiagnosticReport = z.infer<typeof diagnosticReport>;

/**
 * Roll up an array of per-check statuses into a single report-level status.
 * Skips do not count toward the rollup (they represent "did not run", not
 * a failure mode). Keeps every emit-site agreeing on the same precedence.
 */
export function rollupDiagnosticStatus(
  statuses: readonly DiagnosticCheckStatus[],
): DiagnosticReportStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  return "ok";
}

// ---------------------------------------------------------------------------
// Bundle: aggregate of many DiagnosticReports (one envelope per
// `surface:diagnose` invocation).
//
// Designed to be safe to paste into a public GitHub issue. The producer
// (scripts/diagnose.mjs) is responsible for never embedding secret values;
// the schema accepts only structured, redacted summaries.
// ---------------------------------------------------------------------------

export const diagnosticEnvironment = z
  .object({
    os: z.string().min(1),
    osRelease: z.string().optional(),
    arch: z.string().min(1),
    node: z.string().min(1),
    pnpm: z.string().optional(),
    xcode: z.string().optional(),
  })
  .strict();
export type DiagnosticEnvironment = z.infer<typeof diagnosticEnvironment>;

// Project-config snapshot. Kept open-ended (z.record) on purpose: the
// diagnose bundle composes contributions from multiple probes and the exact
// keys evolve faster than this schema should. Producers must never put raw
// secret values here — the redaction policy lives in scripts/diagnose.mjs.
export const diagnosticConfig = z.record(z.string(), z.unknown());
export type DiagnosticConfig = z.infer<typeof diagnosticConfig>;

export const diagnosticBundle = z
  .object({
    schemaVersion: z.literal("1"),
    // Random short id (e.g. UUID v4 first segment) per bundle invocation,
    // so a maintainer can correlate the .json and .md outputs.
    bundleId: z.string().min(1),
    generatedAt: z.iso.datetime(),
    // Rolled-up status across all reports. Same precedence as the
    // per-report rollup: any fail → fail, any warn → warn, else ok.
    status: diagnosticReportStatus,
    environment: diagnosticEnvironment,
    config: diagnosticConfig,
    reports: z.array(diagnosticReport).min(1),
  })
  .strict();
export type DiagnosticBundle = z.infer<typeof diagnosticBundle>;
