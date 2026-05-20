---
"@mobile-surfaces/surface-contracts": minor
---

Projection helpers (`toLiveActivityContentState`, `toWidgetTimelineEntry`, `toControlValueProvider`, `toLockAccessoryEntry`, `toStandbyEntry`, `toNotificationContentPayload`) now run their constructed output through the paired Zod schema and throw a new `ProjectionInvariantError` if the parse fails. The check fires at the call site rather than letting an invalid payload reach ActivityKit, WidgetKit, or APNs where the failure mode is silent placeholder rendering.

The input gate is unchanged: a snapshot that already parsed against `liveSurfaceSnapshot` is guaranteed to satisfy every projection schema, so the new throw path only fires on a bug in the helper itself (a renamed field, a missing literal, a forgotten optional flag). Callers receive the same return types as before. Catch the new error only if you have a deliberate fallback story for an unreachable bug; the right fix is almost always to update the helper.

New public export: `ProjectionInvariantError` (subclass of `Error`, fields `helper: string` and `issues: ZodIssue[]`).

This replaces the path the v9 plan originally sketched as `Result<T, ProjectionError>`. Returning a Result would force every caller across the workspace to discriminate `ok`/`err` for a path that never fires when the input is validated, which is permanent API friction with no payoff. A throw at the call site achieves the same "close the loop" intent without the breaking change.

The package's unit suite (formerly at `scripts/surface-contracts.test.mjs`) moves to `packages/surface-contracts/test/surface-contracts.test.mjs` so the published package's tests live next to the code they exercise. A new `pnpm --filter @mobile-surfaces/surface-contracts test` script runs every `test/*.test.mjs` file. No behavior change to the test contract.
