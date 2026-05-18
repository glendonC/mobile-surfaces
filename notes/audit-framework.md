# Audit Framework

The deterministic checklist any honest audit of this repo must fill. Companion data lives in `notes/audit-state.md`.

## Why this exists

Repeated honest audits of Mobile Surfaces have returned different ~20-finding subsets each run, because the codebase has more surface area than any single sampling pass can cover (4500+ doc lines, 58 check scripts, 8 packages, 3 apps, 50KB AGENTS.md). Without a standing grid, the headline grade swings and the user cannot tell whether the project is improving or just being re-described.

## The rule

The grid IS the audit report. Run an audit by filling cells in `audit-state.md`, not by writing prose. The deliverable of an audit is `git diff notes/audit-state.md`.

If a finding does not fit a cell, extend this framework before recording the finding. Drift in the framework itself is a defect.

## Verdict vocabularies (closed sets)

Cells must use these literal values; if a new value is needed, add it here first.

- **PACKAGE**: `SHIP` | `DEGRADED` | `BROKEN` | `DEPRECATED`
- **TRAP**: `PR-ENFORCED` | `RUNTIME-SDK` | `WARN-ONLY` | `DOC-ONLY` | `DUPLICATE` | `RETIRED` | `UNWIRED`
  - `PR-ENFORCED`: orchestrator step exists, fails build on violation
  - `RUNTIME-SDK`: SDK throws a typed error at call time; no PR gate
  - `WARN-ONLY`: a check script emits a warning bound to this trap id but does not fail the build (catalog severity will typically disagree)
  - `DOC-ONLY`: prose only; no code-level enforcement at any layer
  - `DUPLICATE`: same condition as another rule (cite via `siblings`)
  - `RETIRED`: `deprecated: true` in catalog
  - `UNWIRED`: enforcement.script is set but not in `scripts/lib/check-registry.mjs`
- **CLAIM**: `MATCHES` | `OVERSTATES` | `LIES` | `STALE`
  - `MATCHES`: claim is literally true today
  - `OVERSTATES`: directionally correct but the number/scope is inflated
  - `LIES`: opposite of reality
  - `STALE`: was true at some past version; now superseded
- **BRANCH**: `MERGED` | `ACTIVE` | `STALE` | `ORPHAN`

## Sections to fill in `audit-state.md`

### S1. Packages
Row per package under `packages/`. Columns:
- `name` `version` `bin-declared` `bin-exists` `files-declared-exist` `README-matches-code` `known-bugs` `verdict`

### S2. Trap catalog
Row per non-retired entry in `data/traps.json`. Columns:
- `id` `severity` `detection` `enforcement.script` `in-registry` `ci-gated` `has-test` `verdict` `notes`

Cell-value rules (no editorializing - these must be literal):
- `enforcement.script` cell is the literal value from `data/traps.json` (or `n/a` if absent). Commentary belongs in `notes`.
- `in-registry`, `ci-gated`, `has-test` are tri-state: `yes` | `no` | `n/a`. No other values allowed.
- `in-registry` = `yes` iff `scripts/lib/check-registry.mjs` contains a registry entry whose `script` matches AND whose `trapIds[]` array contains this id.
- `ci-gated` = `yes` iff `.github/workflows/ci.yml` invokes a step (`pnpm surface:check`, `pnpm test:scripts`, etc.) that exercises this script.
- `has-test` = `yes` iff `scripts/<basename>.test.mjs` exists.

### S3. Public claims
Row per quantitative or comparative claim in the public surface. Sources to scan exhaustively:
- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `apps/site/src/**/*.{astro,md,mdx,ts}`
- `packages/*/README.md`
- `packages/*/package.json` `description` field

Columns: `source:line` `claim` `reality-source` `verdict` `notes`

### S4. Cross-cutting findings
Anything that does not fit S1-S3. Columns: `id` `file:line` `issue` `severity` `task-ref`
- `id` is a short slug; reuse across audits so rows can be diffed.
- `task-ref` links to a TaskList row when one exists.

### S5. Branch posture
Row per local + remote branch. Columns: `branch` `head` `vs-main` `last-activity` `verdict` `action`

## Procedure for running an audit

1. `git status`; record current branch + date in `audit-state.md` frontmatter.
2. Refresh S1 from `ls packages/` and each `package.json`.
3. Refresh S2 from `data/traps.json` + `scripts/lib/check-registry.mjs` + `.github/workflows/ci.yml` + `ls scripts/check-*.test.mjs`.
4. Refresh S3 by greppng every source listed above for digit-bearing or comparative phrases.
5. Refresh S4 by carrying forward unresolved rows from previous audit + adding new ones.
6. Refresh S5 from `git branch -a` and last-activity dates.
7. `git diff notes/audit-state.md` - the diff is the report.
8. Commit with a one-line subject and the diff as evidence.

## Anti-patterns

- Writing a narrative audit report without updating `audit-state.md`.
- Adding a row that uses a verdict word not in the closed set above.
- Sampling a subset of packages or rules and calling it complete.
- Treating "AGENTS.md says X" as evidence X is true. AGENTS.md is generated from `data/traps.json`; the canonical source is the json.

## When the grid stops changing

If two consecutive audits produce no diff in `audit-state.md`, the project has reached a stable state at the current set of cells. Either expand the framework or ship the release.
