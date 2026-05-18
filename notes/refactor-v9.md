# Mobile Surfaces v9 Refactor - Master Plan

Status: planning (written 2026-05-17)

Drives toward a single coordinated v9.0.0 cut of the linked group (`surface-contracts`, `validators`, `traps`) plus aligned independent majors for the SDK packages where their public surface changes.

Source of findings: `notes/audit-state.md` (v8 baseline) + the prior five-agent audit. Every section below maps to a row in `audit-state.md` S4 (cross-cutting findings). The audit grid is the spec; this file is the execution plan.

## Cross-cutting decisions (pin these before phase work starts)

- **Headline number**: README, CLAUDE.md, AGENTS.md, site landing, and `vs-expo-live-activity.md` all converge on a single honest count of PR-gated error rules (today: 21) and a stable "21 PR-gated / 6 SDK-runtime-enforced / 8 advisory + warning" breakdown derived from the audit grid. Any future trap addition that changes these numbers must update the grid + every claim site in the same PR; a new check script (Phase 5b) enforces this.
- **One-maintainer disclosure**: README adds a brief "this is a single-maintainer reference architecture; battle-testing breadth scales with adoption" line. Removes the implication of team-level production usage that the four-major release cadence currently projects.
- **Three retired ideas stay retired**: roadmap.md is demoted from `apps/site/` (already done in v7 phase 5f) and remains out of the published site. The `mobile-surfaces audit` standalone bin is either fully shipped in Phase 4 or formally dropped from the catalog promise.
- **Catalog severity policy is honest**: a rule whose only enforcement is an SDK throw at call time stays `error` only if a corresponding pre-flight check exists in the SDK; otherwise the catalog severity is downgraded to `info` and the rule is moved to `detection: "advisory"`. The `error` severity reads "fails the build" to readers; it must mean that or be reclassified.
- **Linked-group membership stays as-is**: `surface-contracts + validators + traps`. Push, live-activity, tokens, example-domain version independently. The push README v5-linked-group claim is fixed in the v8 hotfix bundle; no v9 work needed here.

## MS-id allocations (monotonic; pre-reserved by this plan)

- **MS044** - APNs env-bundle-id suffix shape. (Phase 1, catalog honesty)
- **MS045** - Live-Activity / APNs environment-tag agreement at token-store boundary (Phase 1; subsumes the runtime-only MS014).
- **MS046** - Catalog-vs-claim headline-number consistency. (Phase 5, enforces the "honest headline" rule above.)

The Phase 1 retirements (MS016, MS020, MS021, MS023, MS026, MS034) demote rather than free the id slots; the ids stay reserved per the monotonic-forever policy.

---

## Phases (sequential where noted; parallel within phase)

### Phase 0 - Audit baseline freeze

Must complete before any other phase. The intent is to keep audits comparable across the v9 cycle.

- 0a. Tag the current `audit-state.md` as the v8 baseline. Snapshot at `notes/audit-state.v8.md` so the v9 closure pass (Phase 6) can diff against it without git archeology.
- 0b. Open a tracking issue per S4 row, link from the audit-state.md row's `task-ref` cell.
- 0c. Verify (manually) every `audit-state.md` row's file:line reference is still accurate against current `main` HEAD. Any stale row is updated before phase work begins.

### Phase 1 - Catalog honesty (task #6)

Goal: every `error`-severity row in `data/traps.json` is either PR-enforced, SDK-pre-flight-enforced with a typed error class, or downgraded out of `error` severity. The catalog stops disagreeing with itself.

- 1a. **Build MS044** (`APNS_BUNDLE_ID` must not include the `.push-type.liveactivity` suffix at env-var time, not just app.json). New check `scripts/check-apns-env-shape.mjs` runs in CI even without secrets - it asserts that the env-var EXAMPLE (`.env.example`, README snippets) is suffix-free and that any docs example matching the pattern `APNS_BUNDLE_ID=*\.push-type\.liveactivity` is rejected. Wires into registry, gets a test. Extends MS018 with the runtime-detection complement.
- 1b. **Build MS045** (token-environment agreement). New static check `scripts/check-token-environment-binding.mjs` verifies that any reachable `tokenStore.upsert()` call site reads `environment` from a `process.env`-derived source (rather than a hard-coded literal that would diverge from the APNs config). This catches the "token from production build sent to development APNs" failure class that today only surfaces as a 400. Wires into registry.
- 1c. **Retire MS016** (subscribe-at-mount). Move to `detection: "advisory"`, severity `info`. The constraint is real but there is no enforceable static or runtime gate; documenting it as such matches reality.
- 1d. **Retire MS020 / MS021 / MS023** (token rotation / discard-at-end / per-activity binding). All three are tokens-package-internal invariants. MS020 is already covered structurally by the token store's `latestWriteWins` Map keying (recorded in `tokens/src/index.ts` header). MS021 is encoded in the `markEnding -> markDead` lifecycle. MS023 is implicit in the `kind: "perActivity"` discriminant. Downgrade to `info` / `advisory` and note in catalog summary that the constraint is encoded structurally rather than gate-enforced.
- 1e. **Reclassify MS026** (`expo-target.config.js` present). Either: (a) promote the existing warn-emit in `probe-app-config.mjs` to a `fail` (and add a `trapIds: ["MS026"]` binding in the registry); or (b) downgrade catalog severity to `warning`. The choice depends on whether a fresh-scaffold project always lands an `expo-target.config.js`. Decide via Phase 1 spike - if yes, promote; if not, downgrade.
- 1f. **Retire MS034** (broadcast capability). Pure operational; the iOS 18 broadcast capability is a JWT auth-key property an APNs operator toggles. There is no client-side gate possible. Move to `detection: "advisory"`, severity `info`.
- 1g. **Merge MS012 + MS027**. Both fire the same deployment-target-min check on the same file. Keep MS012 as the canonical id; demote MS027 to `deprecated: true` with a one-line tombstone pointing at MS012. AGENTS.md renderer updated to surface the alias in the retired-ids footnote.
- 1h. **Merge MS018 + MS035 framing**. Keep both rules (they are distinct symptoms - env-var shape vs missing topic header) but cross-link in the catalog `siblings` field (already partly there) and add a joint "you probably want MS044's static gate" pointer.
- 1i. **MS037 split** (notification-categories codegen drift). Today MS037 is a single gate that bundles "regen check" + "TS export sync". Split into two registry entries with distinct error messages; same trap id but clearer diagnostics.

### Phase 2 - Architecture seams (task #7)

Goal: remove the "guard built on guard" pattern where multiple drift-checks compensate for an unfinished generator.

- 2a. **Swift shared-state codegen.** Extend `scripts/generate-activity-attributes.mjs` (or add `scripts/generate-shared-state.mjs`) to emit `MobileSurfacesWidgetSnapshot`, `MobileSurfacesControlSnapshot`, `MobileSurfacesLockAccessorySnapshot`, `MobileSurfacesStandbySnapshot` (and the `notification` envelope) from their Zod projection-output schemas. Existing `check-surface-snapshots.mjs` (MS036) becomes the byte-identity / parity check for the generator output instead of for hand-written structs. Removes the inconsistency where ActivityAttributes is generated but the four sibling Codables are hand-maintained.
- 2b. **Remove `z.lazy()` wrapper on the main union.** `packages/surface-contracts/src/schema.ts:514-522`. The cold-start argument is unproven and the wrapper breaks some downstream type-narrowing. Drop the wrapper; rely on Zod's normal discriminated-union construction. Verify via a microbenchmark check-in (one-shot, not in CI).
- 2c. **MS041 ordering rule: relax the regex.** `scripts/check-projection-envelope-version.mjs:103-104` enforces "first property must be `schemaVersion`" using a regex over the source. The Swift probe consuming it uses Codable which is key-based, not order-sensitive - so the "first" constraint protects nothing. Keep the literal-typed check (`z.literal("5")`), remove the ordering sub-rule. Update the rule prose in `data/traps.json` to match.
- 2d. **Replace Zod-internals reach in `check-activity-attributes.mjs`.** Currently uses `schema?._zod?.def` and `def.entries` (private). Replace with `schema.shape` walking (public) plus a small Zod-version-pin regression test that asserts the public API still exposes what we need. Lock Zod to `4.3.6` for now (already exact-pinned); the test surfaces if the next Zod minor breaks the API.
- 2e. **Audit the projection helpers in `surface-contracts/src/index.ts:110-231` for round-trip soundness.** Add a Zod parse on the OUTPUT of each `toX...` helper inside the helper itself, returning `Result<T, ProjectionError>`. Today the safety relies entirely on fixture-driven snapshot tests catching typo-class mistakes; an internal parse closes the loop at the call site.

### Phase 3 - Positioning + docs reconciliation (task #8)

Goal: the user-facing surface (README, landing, key docs) accurately describes what ships and who it's for.

- 3a. **Update `apps/site/src/components/Island.astro`** to drop "starter" framing. Lead with the wire-format-above-the-bridge thesis from `notes/positioning.md:122`. Remove "fastest way to ship" superlatives.
- 3b. **README "who is this for" section**. New 5-line block near the top naming the realistic user: "Expo iOS team shipping a multi-surface domain with a Node backend; using `expo-live-activity` or any other ActivityKit bridge is fine - Mobile Surfaces is the contract and push-side layer above whichever bridge."
- 3c. **README single-maintainer disclosure**. One line: "Mobile Surfaces is a single-maintainer reference architecture; the trap catalog and push SDK reflect failure modes encountered in the reference app, not a survey of every production deployment."
- 3d. **Cap doc surface area.** Audit `apps/site/src/content/docs/**`; merge or retire any page whose unique-content ratio drops below ~30% (lots of duplication today between `push.md`, `backend.md`, and `concepts.md`). Target: keep total doc-site word count flat across v9 even as new sections land.
- 3e. **`vs-expo-live-activity.md` decision matrix audit**. The "foreign Expo project" row currently references the audit subcommand; depending on Phase 4 outcome, either restore the `npx mobile-surfaces audit .` row or convert to "read `/docs/traps` and apply each rule manually".
- 3f. **`packages/example-domain/README.md` "v5 schema generation" phrasing**. Replace with "wire schemaVersion 5" everywhere to avoid the v5-the-package-version vs v5-the-wire-version confusion.
- 3g. **Doc-promises lint extension**. Today `scripts/check-doc-promises.mjs` greps for TODO/FIXME/coming-soon. Extend to also flag unsubstantiated comparatives ("fastest", "production-grade", "the only") in `apps/site/src/content/docs/**` unless paired with a citation or test reference on the same line.

### Phase 4 - CLI rigor (task #9)

Goal: ship the `mobile-surfaces audit` subcommand for real, or formally drop it.

- 4a. **Decision spike**: poll the maintainer (Glendon) on whether the audit subcommand justifies the work to ship correctly. Two options:
  - **Ship**: bundle the gate scripts inside the published tarball, refactor each script to accept a `rootDir`, write real tests against a synthetic foreign-project fixture, restore the `mobile-surfaces` bin entry to a thin entrypoint.
  - **Drop**: remove `src/audit.mjs` and all references in docs; the catalog is consumed inside a Mobile Surfaces checkout via `pnpm surface:check`. The promise was load-bearing in vs-expo; the v8 hotfix bundle already softened that, this finalizes.
- 4b. **If shipping** (4a yes): refactor `scripts/probe-app-config.mjs`, `scripts/check-app-group-identity.mjs`, `scripts/check-ios-gitignore.mjs`, `scripts/doctor.mjs` to accept a `rootDir` argument (default cwd). Bundle these in the CLI tarball under `bin/scripts/` and resolve via `import.meta.url`. The current `src/audit.mjs:42-55` walk-up-to-find-scripts heuristic is removed.
- 4c. **If shipping**: write `packages/create-mobile-surfaces/test/audit.test.mjs` exercising the audit subcommand against a `test/fixtures/foreign-project/` synthetic tree (a minimal Expo app with one MS013/MS025 violation, one MS029 violation, etc.). Pin pass/fail per fixture.
- 4d. **Validators package hardening** (independent of 4a): add reserved-bundle-id list (`com.apple.*`, `com.google.*`, `com.amazon.*`, etc.), length caps (255 for slug per filesystem realities, 155 for bundle id per Apple), Unicode normalization (NFKC), template-default clash detection. Each new rule gets a test.
- 4e. **Snapshot test escape-hatch**. Today `packages/create-mobile-surfaces/test/snapshot-scaffold.test.mjs` excludes the CLI internals from its hash. Add a separate CLI-logic regression test (not snapshot-driven) that asserts: every `apply*` task is reachable from at least one mode (greenfield / add-existing / monorepo), every prompt validator wired into a real prompt, every `--flag` reachable from `parseFlags`. Catches regressions the file-hash snapshots cannot.

### Phase 5 - Versioning charter + CI gates (cross-cutting)

- 5a. **MS046** (catalog-vs-claim headline consistency). New `scripts/check-headline-counts.mjs` runs in CI: greps the documented quantitative claims out of `README.md`, `CLAUDE.md`, `AGENTS.md` index header, and `apps/site/src/content/docs/vs-expo-live-activity.md`, and asserts they match the breakdown computed from `data/traps.json` + `scripts/lib/check-registry.mjs`. The grid then becomes the source of truth for every public number. Fails on drift.
- 5b. **Pin the audit framework in CI** (light touch). Add `pnpm audit:diff` script that prints `git diff notes/audit-state.md` and fails if the diff is non-empty without a paired update in `audit-state.md`'s `audit-date` header. Optional: run on PRs that touch `data/traps.json` or `scripts/check-*.mjs`. The intent is to make audit-state.md the canonical changelog for the catalog's enforcement surface.
- 5c. **Linked-group bumps to 9.0**. `surface-contracts + validators + traps` cut at 9.0 with the Phase 1 catalog changes (rule retirements + new MS-ids) as the breaking-change rationale. Independent majors for push / live-activity / tokens only if their Phase 2 / Phase 3 work changes the public surface.

### Phase 6 - Audit closure pass (re-runs the framework)

Owned end-to-end by the framework introduced in Phase 0.

- 6a. Refresh `notes/audit-state.md` against the post-v9 working tree.
- 6b. `git diff notes/audit-state.v8.md notes/audit-state.md` - the diff is the v9 audit report. Every S4 row should flip from RED/YELLOW to GREEN, or carry a deliberate `WONTFIX` annotation.
- 6c. Spawn a fresh five-agent audit (same agent definitions as the v8 baseline) and confirm: no new findings outside the grid. If a new finding lands, extend the framework first, then record it.
- 6d. Cut the release.

---

## Out of scope (deferred to v10 or later)

- MCP server consuming `@mobile-surfaces/traps`
- Worker-thread JWT cache safety for `@mobile-surfaces/push` (already shipped a `JwtCacheLike` strategy in v7; full multi-worker coordination is a v10 push package independent major)
- Android, web, watchOS surfaces - out of scope by charter
- Visual redesign of the landing page (deferred per `feedback_visual_redesigns`)
- A second reference domain (the DeliveryOrder example is sufficient for v9)

## Conflicts to resolve during execution

| Conflict | Decision deadline | Owner |
|---|---|---|
| Phase 4 ship-vs-drop the audit subcommand | end of Phase 0 | maintainer |
| Phase 1e MS026 promote-vs-downgrade | end of Phase 1 spike | maintainer |
| Phase 2a Swift-shared-state generator name (`generate-activity-attributes.mjs` extension vs new `generate-shared-state.mjs`) | end of Phase 2 | implementer |
| Phase 3d which doc pages to merge / retire | end of Phase 3 | maintainer + brand-voice review |

## Dependency graph

```
Phase 0 -> Phase 1 -> Phase 5c
Phase 0 -> Phase 2 -> Phase 5c
Phase 0 -> Phase 3 (parallel with 1/2)
Phase 0 -> Phase 4 (parallel with 1/2/3, gated on 4a decision)
Phase 1/2/3/4 -> Phase 5a/5b (the lints can only land after their target surfaces stabilize)
Everything -> Phase 6
```

## How this plan stays honest

If the v9 phases land and the grid still has RED rows in S4, do not cut the release. Open the bag back up. The audit-framework rule that "the grid IS the report" applies to v9 the same way it applied to v8 - the diff against `audit-state.v8.md` is what passes or fails the release gate.
