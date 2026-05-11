---
"@mobile-surfaces/surface-contracts": minor
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

surface-contracts: wrap the `liveSurfaceSnapshot` discriminated union in `z.lazy()` so the preprocess + discriminated-union construction is deferred to the first `parse` / `safeParse` call instead of running at module import. Backends that import the package but rarely validate, and short-lived serverless invocations that rarely hit the codepath, no longer pay the construction cost on cold start. `.parse` / `.safeParse` pass through transparently; the per-kind variant schemas stay eagerly built and unchanged.

create-mobile-surfaces: tighten the apply phase for both existing-Expo and existing-monorepo flows so it walks each file once per substitution batch instead of N times. `rewriteContent` (apply-existing) now runs one regex pass with left-to-right alternation; `applySubstitutionsToString` (apply-monorepo) collapses literal substitutions into one alternation regex looked up via a Map. For the typical 6-literals + 1-regex monorepo rewrite, that drops from 7 passes to 2.

create-mobile-surfaces: collapse the standalone `applyAppleTeamId` and `applyNewArchEnabled` helpers into a single exported `applyAppJsonPatches`. Production already used the batched form; the standalone helpers existed only to keep unit tests focused. Tests now drive `applyAppJsonPatches` directly and a new combined-pass test pins that both writes land in one read-modify-write.

create-mobile-surfaces: add a decision-tree comment in `detectMode` so the precedence order is scannable without tracing, and reword `--no-new-arch` help to "use the legacy React Native bridge instead" rather than the bare "legacy bridge" jargon.
