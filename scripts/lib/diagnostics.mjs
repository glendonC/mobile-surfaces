// Shared emit helpers so every check script under scripts/ produces a
// validated DiagnosticReport in --json mode and matching pretty output in
// human mode without duplicating boilerplate.
//
// Consumers build the report object, then call emitDiagnosticReport(report,
// { json }). The helper validates against the Zod schema, prints the
// appropriate output, and exits with the right code on failures.
import {
  diagnosticReport,
  rollupDiagnosticStatus,
} from "../../packages/surface-contracts/src/diagnostics.ts";

/**
 * Emit a DiagnosticReport in either JSON or human form. Validates against the
 * Zod schema before output so a malformed report can never leak. Calls
 * process.exit(1) when the rolled-up status is "fail" — never returns in that
 * case. Otherwise returns void.
 *
 * @param {object} report  Object matching DiagnosticReport (pre-validation).
 * @param {{ json: boolean }} options
 */
export function emitDiagnosticReport(report, options) {
  const validated = diagnosticReport.parse(report);
  if (options.json) {
    process.stdout.write(JSON.stringify(validated) + "\n");
  } else {
    renderHumanReport(validated);
  }
  if (validated.status === "fail") {
    process.exit(1);
  }
}

/**
 * Build a DiagnosticReport from a tool name and an array of checks. Sets
 * timestamp to now, schemaVersion to "1", and rolls the report-level status
 * up from the per-check statuses.
 */
export function buildReport(tool, checks) {
  return {
    schemaVersion: "1",
    tool,
    timestamp: new Date().toISOString(),
    status: rollupDiagnosticStatus(checks.map((c) => c.status)),
    checks,
  };
}

function renderHumanReport(report) {
  for (const check of report.checks) {
    const prefix =
      check.status === "ok"
        ? "✓"
        : check.status === "warn"
          ? "⚠"
          : check.status === "fail"
            ? "✗"
            : "•";
    const trapTag = check.trapId ? ` [${check.trapId}]` : "";
    process.stdout.write(`${prefix}${trapTag} ${check.summary}\n`);
    if (check.detail?.message) {
      process.stdout.write(`  ${check.detail.message}\n`);
    }
    if (check.detail?.issues) {
      for (const issue of check.detail.issues) {
        const path = issue.path || "(root)";
        process.stdout.write(`  - ${path}: ${issue.message}\n`);
      }
    }
    if (check.detail?.paths) {
      for (const p of check.detail.paths) {
        process.stdout.write(`  - ${p}\n`);
      }
    }
  }
}
