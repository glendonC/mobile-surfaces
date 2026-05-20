---
"@mobile-surfaces/traps": minor
---

Add MS044 to the trap catalog: catalog headline counts stay in sync with the trap catalog. The rule is enforced by `scripts/generate-catalog-stats.mjs`, which generates `data/catalog-stats.json` (the canonical breakdown of total, live, deprecated, severity, detection, and PR-gated counts) and rewrites the `catalog-stats:` marker blocks in `README.md` and the doc site. A rule added, retired, or reclassified now fails the build unless every published count is regenerated alongside it.

Public-surface impact for `@mobile-surfaces/traps` consumers: `TRAP_BINDINGS` and the `TrapId` union gain `MS044`; filtering by severity returns one more `error` rule and filtering by detection one more `static` rule. Headline catalog counts become 40 live rules (32 error, 2 warning, 6 info) with 4 retired ids reserved.
