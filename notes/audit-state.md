---
audit-date: 2026-05-20
branch: v9-closure-audit
audit-target: post-v9 working tree; Phases 1-5 complete, PRs #115-#135 merged
prior-audit: notes/audit-state.v8.md (frozen snapshot of the 2026-05-17 baseline)
framework-version: notes/audit-framework.md
verification-pass: 2026-05-20 (Phase 6a per notes/refactor-v9.md)
---

# Audit State: v9 closure refresh

Filled per `notes/audit-framework.md`. The diff against `notes/audit-state.v8.md` is the v9 audit report; the diff against the prior `audit-state.md` revision is the Phase 6 closure delta.

## Phase 6a refresh log (2026-05-20)

Every Phase 1-5 task tracked in the prior S4 grid has shipped. Summary of cell changes against the 2026-05-19 revision:

- S1 `@mobile-surfaces/validators`: DEGRADED -> SHIP. Reserved-bundle-id list, length caps, NFKC normalization, and template-default clash detection shipped in #120 (Phase 4d).
- S2: MS016/MS020/MS021/MS023/MS034 demoted to `info`/`advisory` (#115); MS027 retired as a deprecated MS012 alias (#115); MS026 promoted to a build-failing config gate (#116); MS044 added (#132); the live-rule count is now 40 (was 40 with a different membership) and the error count is 32.
- S2: the v4 schema codec was removed (#134); this is a `surface-contracts` source change, not a catalog change, and is recorded in S3 / S4.
- S3: every claim flagged OVERSTATES/LIES/STALE in the prior revision was corrected by a Phase 3 or Phase 5 PR; see the section for per-row task refs.
- S4: every YELLOW row resolved by its Phase 1-4 PR; the lone RED row (`push-md-trap-id-symbol-lies`) resolved by #131. `live-activity-peer-floor-unverified` and `typed-errors-every-claim-unverified` were verified clean in this pass.
- S5: the v9 feature branches are all merged; only `main` and the changeset bot branch remain live.

The Phase 6c five-agent audit surfaced one finding outside the grid: a stale `@5` install pin in `packages/push/README.md`. It was fixed in this closure pass and recorded below. No other new findings; the false-positive "validators changeset must be major" was dismissed (the changesets `linked` group already bumps validators to 9.0.0, confirmed by `pnpm changeset status`).

Grid posture after this refresh: **zero RED rows, zero unresolved YELLOW rows.** One Phase 6 action item (`doc-schema-url-release-bump`) is open and is handled at 6d.

## S1. Packages

| name | version | bin declared | bin exists | files declared exist | README matches code | known bugs | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `create-mobile-surfaces` | 7.1.1 | `create-mobile-surfaces:./bin/index.mjs` only | yes | yes | yes; the `mobile-surfaces audit` subcommand was dropped in #124 and the docs now describe the in-checkout `pnpm surface:audit` wrapper | none recorded | SHIP |
| `@mobile-surfaces/example-domain` | 0.1.1 | n/a | n/a | yes | yes | none recorded | SHIP |
| `@mobile-surfaces/live-activity` | 7.1.1 | n/a | n/a | yes | yes; peer-floor claim verified against `peerDependencies` in this pass | none recorded | SHIP |
| `@mobile-surfaces/push` | 7.1.1 | n/a | n/a | yes | yes; construction-time and send-time environment guards added in #122 | `#retryPolicy` deprecation warn uses a module-global flag (`src/client.ts`; acknowledged in code comment) | SHIP |
| `@mobile-surfaces/surface-contracts` | 8.0.0 | n/a | n/a | yes | yes; the frozen v4 codec was removed in #134 and the docs rewritten to match | none recorded | SHIP |
| `@mobile-surfaces/tokens` | 7.1.1 | n/a | n/a | yes | yes | none recorded | SHIP |
| `@mobile-surfaces/traps` | 8.0.0 | n/a | n/a | yes | yes | none recorded | SHIP |
| `@mobile-surfaces/validators` | 8.0.0 | n/a | n/a | yes | yes | none recorded; reserved-id list, length caps, NFKC normalization, and clash detection shipped in #120 | SHIP |

Package versions are the pre-release values; the linked-group 9.0.0 / push 7.2.0 bumps land via the held "Version packages" PR at 6d.

## S2. Trap catalog

40 live rules + 4 retired. `in-registry`, `ci-gated`, and `has-test` are tri-state (`yes` / `no` / `n/a` for retired).

| id | sev | detection | enforcement script | in-registry | ci-gated | has test | verdict | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MS001 | error | static | check-adapter-boundary.mjs | yes | yes | yes | PR-ENFORCED | |
| MS002 | error | static | check-activity-attributes.mjs | yes | yes | yes | PR-ENFORCED | shared with MS003/MS004 |
| MS003 | error | static | check-activity-attributes.mjs | yes | yes | yes | PR-ENFORCED | |
| MS004 | error | static | check-activity-attributes.mjs | yes | yes | yes | PR-ENFORCED | |
| MS005 | info | advisory | n/a | n/a | n/a | n/a | RETIRED | id reserved |
| MS006 | error | static | build-schema.mjs (with `--check`) | yes | yes | no | PR-ENFORCED | generator doubles as check |
| MS007 | error | static | validate-surface-fixtures.mjs | yes | yes | no | PR-ENFORCED | |
| MS008 | error | static | surface-contracts.test.mjs | yes | yes | self | PR-ENFORCED | the test file IS the check |
| MS009 | error | static | generate-surface-fixtures.mjs (with `--check`) | yes | yes | yes | PR-ENFORCED | |
| MS010 | warning | config | doctor.mjs | yes | no | no | WARN-ONLY | `doctor` is registry stage 0 (diagnose-only); emits a toolchain warning, never fails a build |
| MS011 | error | runtime | n/a (SDK preflight) | n/a | n/a | yes (push) | RUNTIME-SDK | `PayloadTooLargeError`; preflight in `packages/push/src/preflight.ts` |
| MS012 | error | config | probe-app-config.mjs | yes | yes | no | PR-ENFORCED | MS027 retired as its alias |
| MS013 | error | static | check-app-group-identity.mjs | yes | yes | yes | PR-ENFORCED | |
| MS014 | error | runtime | n/a (SDK preflight) | n/a | n/a | yes (push) | RUNTIME-SDK | `TokenEnvironmentMismatchError` send-time preflight added in #122 |
| MS015 | warning | runtime | n/a | n/a | n/a | no | RUNTIME-SDK | typed `TooManyRequestsError` |
| MS016 | info | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | demoted from error in #115 |
| MS017 | error | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | advisory by design (apps/mobile/ios is generated) |
| MS018 | error | runtime | n/a (SDK guard) | n/a | n/a | yes (push) | RUNTIME-SDK | DUPLICATE with MS035; `MalformedApnsConfigError` construction-time guard added in #122 |
| MS019 | info | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | FB21158660 advisory |
| MS020 | info | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | demoted from error in #115 |
| MS021 | info | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | demoted from warning in #115 |
| MS022 | info | advisory | n/a | n/a | n/a | n/a | RETIRED | merged into MS003 |
| MS023 | info | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | demoted from warning in #115 |
| MS024 | error | config | probe-app-config.mjs | yes | yes | no | PR-ENFORCED | |
| MS025 | error | config | probe-app-config.mjs | yes | yes | no | PR-ENFORCED | |
| MS026 | error | config | probe-app-config.mjs | yes | yes | no | PR-ENFORCED | promoted from a warn-emit to a build-failing gate in #116 |
| MS027 | info | advisory | n/a | n/a | n/a | n/a | RETIRED | deprecated alias of MS012 |
| MS028 | error | runtime | n/a (construction-time throw) | n/a | n/a | yes (push) | RUNTIME-SDK | `MissingApnsConfigError` at `createPushClient` |
| MS029 | error | config | check-ios-gitignore.mjs | yes | yes | yes | PR-ENFORCED | |
| MS030 | error | runtime | n/a | n/a | n/a | yes (push) | RUNTIME-SDK | typed errors per reason class |
| MS031 | error | runtime | n/a | n/a | n/a | yes (push) | RUNTIME-SDK | three typed channel errors |
| MS032 | error | runtime | n/a (SDK preflight) | n/a | n/a | yes (push) | RUNTIME-SDK | timestamp preflight in `packages/push/src/preflight.ts` |
| MS033 | info | advisory | n/a | n/a | n/a | n/a | RETIRED | id reserved |
| MS034 | info | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | demoted from error in #115 |
| MS035 | error | runtime | n/a | n/a | n/a | yes (push) | RUNTIME-SDK | DUPLICATE with MS018; typed `MissingTopicError` |
| MS036 | error | static | generate-surface-swift.mjs (with `--check`) | yes | yes | yes | PR-ENFORCED | surface-snapshot codegen landed in #126 |
| MS037 | error | static | generate-notification-categories.mjs (with `--check`) | yes | yes | no | PR-ENFORCED | per-artifact sub-diagnostics added in #123 |
| MS038 | error | static | check-adapter-parses.mjs | yes | yes | no | PR-ENFORCED | |
| MS039 | error | static | check-token-discipline.mjs | yes | yes | no | PR-ENFORCED | |
| MS040 | error | static | check-traps-swift-byte-identity.mjs | yes | yes | no | PR-ENFORCED | |
| MS041 | error | static | check-projection-envelope-version.mjs | yes | yes | no | PR-ENFORCED | ordering sub-rule relaxed in #117/#127; literal-type check is the load-bearing part |
| MS042 | error | static | check-deprecation-prose.mjs | yes | yes | yes | PR-ENFORCED | |
| MS043 | error | static | check-changelog-on-major.mjs | yes | yes | no | PR-ENFORCED | |
| MS044 | error | static | generate-catalog-stats.mjs (with `--check`) | yes | yes | yes | PR-ENFORCED | added in #132 |

### S2 totals (live rules; totals must sum to 40)

- PR-ENFORCED: 23 (the 18 static rules + 5 config rules: MS012, MS024, MS025, MS026, MS029)
- RUNTIME-SDK: 9 (MS011, MS014, MS015, MS018, MS028, MS030, MS031, MS032, MS035)
- WARN-ONLY: 1 (MS010 - toolchain preflight, registry stage 0, never fails a build)
- DOC-ONLY: 7 (MS016, MS017, MS019, MS020, MS021, MS023, MS034)
- Sum: 23 + 9 + 1 + 7 = 40 ✓
- Retired (excluded from totals): 4 (MS005, MS022, MS027, MS033)
- DUPLICATE pair: MS018 / MS035 (apns-topic / bundle-id suffix); MS012 / MS027 is now a live-rule / retired-alias pair, not a live duplicate.

The canonical public breakdown is generated into `data/catalog-stats.json` and the README + vs-expo marker blocks by `scripts/generate-catalog-stats.mjs` (MS044): 40 live rules, 4 retired; by severity 32 error / 2 warning / 6 info; by detection 18 static / 6 config / 9 runtime / 7 advisory; 23 PR-gated. No public catalog number is hand-maintained.

## S3. Public claims

| source | claim | reality source | verdict | notes |
| --- | --- | --- | --- | --- |
| `CLAUDE.md:18`, `AGENTS.md:18` | "40 live rules: 32 error, 2 warning, 6 info. 4 retired ids reserved" | generated from data/traps.json by build-agents-md.mjs | MATCHES | counting logic shared with generate-catalog-stats via scripts/lib/catalog-stats.mjs |
| `README.md:16` | "<catalog-stats:live> documented iOS silent-failure modes ... enforced as CI invariants ... Static rules fail at PR time; runtime rules surface as typed errors" | data/catalog-stats.json; S2 grid | MATCHES | the count is a generated marker; the mechanism sentence honestly splits static vs runtime |
| `README.md:18` | single-maintainer reference-architecture disclosure | shipped #119 (Phase 3c) | MATCHES | |
| `README.md:14` | surface-contracts feature list | no longer claims a "v4 migration codec" after #134 | MATCHES | |
| `README.md:15` | "typed errors for every documented APNs reason" | `packages/push/src/reasons.ts` + `errors.ts`; every guide reason has a subclass and `UnknownApnsError` is the catch-all | MATCHES | verified this pass; prior STALE-RISK cleared |
| `apps/site/src/content/docs/vs-expo-live-activity.md:25,74` | catalog counts (documented / PR-gated / runtime / remainder) | `data/catalog-stats.json` marker blocks | MATCHES | generated by MS044; cannot drift from the catalog |
| `apps/site/src/components/Island.astro` | landing copy | reframed around the wire-format thesis in #119; superlatives removed | MATCHES | prior "fastest way to ship" / "starter" framing resolved |
| `apps/site/src/content/docs/schema.md`, `concepts.md`, `stability.md`, `backend.md` | v4 codec / `safeParseAnyVersion` prose | `surface-contracts` source after #134 | MATCHES | rewritten to past tense; no doc implies the codec still exists |
| `apps/site/src/content/docs/{schema,concepts,backend,adopt}.md` | JSON Schema URL `@8.0/schema.json` | `surface-contracts` package.json 8.0.0 | MATCHES | accurate pre-release; the 9.0 bump requires a doc-URL refresh - see S4 `doc-schema-url-release-bump` |
| `packages/live-activity/README.md:13` | "Expo SDK 55+, React Native 0.83+, React 19.2+" | `peerDependencies` (`expo >=55`, `react >=19.2`, `react-native >=0.83`) | MATCHES | verified this pass; prior STALE-RISK cleared |
| `packages/example-domain/README.md` | "wire schemaVersion 5" phrasing | shipped #128 (Phase 3f) | MATCHES | prior "v5 schema generation" ambiguity resolved |
| `apps/site/src/content/docs/push.md:380` area | error-class catalog binding prose | `@mobile-surfaces/traps` `ERROR_CLASS_TO_TRAP_ID`; the two duplicate error tables merged in #131 | MATCHES | prior RED `trapIdForErrorClass` lie resolved; prose describes the real lazy-lookup mechanism without baking in counts |
| `packages/push/README.md:16` | install command `pnpm add @mobile-surfaces/push@5 @mobile-surfaces/surface-contracts@5` | push is 7.x, surface-contracts 8.x (9.x at release); every other package README install line carries no pin | MATCHES | was STALE; surfaced by the Phase 6c five-agent audit and fixed in this closure pass - pins dropped to match the other READMEs |

## S4. Cross-cutting findings

| id | file:line | issue | severity | task-ref |
| --- | --- | --- | --- | --- |
| cli-bin-missing | packages/create-mobile-surfaces/package.json | declared bin file did not exist | GREEN | shipped #88 |
| tokens-hydration-race | packages/tokens/src/index.ts | upsert during hydration window never persisted | GREEN | shipped #89 |
| live-activity-readme-lies | packages/live-activity/README.md | three contradictions vs shipped code | GREEN | shipped #90 |
| forwarder-off-by-one | packages/tokens/src/forwarder.ts | backoff parity question | GREEN | acknowledged #91 |
| ms026-catalog-drift | data/traps.json MS026 | severity error but only warn-emitted | GREEN | shipped #116 (Phase 1e) |
| ms014-ms016-ms020-ms034-doc-only | data/traps.json | error severity with zero enforcement | GREEN | shipped #115 (Phase 1c/1d/1f) + #122 promoted MS014 to an SDK preflight |
| ms012-ms027-duplicate | data/traps.json | same condition counted twice | GREEN | shipped #115 (Phase 1g); MS027 retired as an alias |
| ms041-ordering-theatrical | scripts/check-projection-envelope-version.mjs | ordering sub-rule protected nothing | GREEN | shipped #117/#127 (Phase 2c) |
| swift-shared-state-handwritten | apps/mobile/targets/_shared/MobileSurfacesSharedState.swift | four Codable structs hand-maintained | GREEN | shipped #126 (Phase 2a); structs generated by generate-surface-swift.mjs |
| zod-internals-reach | scripts/check-activity-attributes.mjs | reached into `_zod.def` private API | GREEN | shipped #117/#127 (Phase 2d) |
| z-lazy-premature-opt | packages/surface-contracts/src/schema.ts | `z.lazy()` wrapper with misleading rationale | GREEN | shipped #117 (Phase 2b) |
| validators-thin | packages/validators/src/index.mjs | regex-only coverage, no reserved-id list or caps | GREEN | shipped #120 (Phase 4d) |
| snapshot-tests-partially-circular | packages/create-mobile-surfaces/test/snapshot-scaffold.test.mjs | exclude list defeated CLI-logic regression detection | GREEN | shipped #125 (Phase 4e); a non-snapshot reachability test was added |
| schema-url-drift-fanout | apps/site/src/content/docs/** | URL pin drift vs actual `$id` | GREEN | shipped #92 |
| jwt-rotation-doc-contradiction | vs-expo-live-activity.md vs push.md | load-bearing security number contradicted itself | GREEN | shipped #92 |
| five-vs-six-surfaces-doc-drift | building-your-app.md, quickstart.md, scenarios.md | docs said "five surfaces"; schema ships six | GREEN | shipped #92 |
| push-linked-group-misclaim | packages/push/README.md | claimed push was in the linked group | GREEN | shipped #92 |
| fastest-superlative-unsubstantiated | apps/site/src/components/Island.astro | unsubstantiated superlative | GREEN | shipped #119 (Phase 3a); a comparative-claims lint added in #129 (Phase 3g) |
| site-starter-vs-wire-format | apps/site/src/components/Island.astro | retired "starter" framing | GREEN | shipped #119 (Phase 3a) |
| readme-headline-overstate | README.md:16 | hand-maintained catalog count, "enforced in CI" overclaim | GREEN | shipped #128 (Phase 3b/3c) + #132 (MS044 makes the count generated) |
| one-maintainer-undisclosed | README, landing | no single-maintainer disclosure | GREEN | shipped #119 (Phase 3c) |
| doc-surface-bloat | apps/site/src/content/docs/** | duplicated doc content | GREEN | shipped #130/#131 (Phase 3d); push.md duplicate error tables merged |
| push-md-trap-id-symbol-lies | apps/site/src/content/docs/push.md:380 | referenced a `trapIdForErrorClass` symbol with a stale 16/11 count | GREEN | shipped #131; prose rewritten against the real mechanism |
| live-activity-peer-floor-unverified | packages/live-activity/README.md:13 | peer-floor claim not verified against `peerDependencies` | GREEN | verified 2026-05-20; README matches `peerDependencies` exactly |
| typed-errors-every-claim-unverified | README.md:15 | "typed errors for every documented APNs reason" not verified | GREEN | verified 2026-05-20; every reason maps to a subclass, `UnknownApnsError` is the catch-all |
| push-retrypolicy-warn-global | packages/push/src/client.ts | module-global flag suppresses across instances | GREEN | acknowledged in code comment; no action needed |
| push-hash-fallback | packages/push/src/hash.ts | FNV-1a fallback engaged silently | GREEN | file deleted; no FNV-1a code remains |
| v4-codec-removed | packages/surface-contracts/src/schema-v4.ts | the frozen v4 codec reached the end of its charter window | GREEN | shipped #134 (Phase 5c); `schema-v4.ts`, `safeParseAnyVersion`, `migrateV4ToV5` removed for the 9.0 cut |
| catalog-headline-drift | README.md, vs-expo-live-activity.md | public catalog counts were hand-maintained prose and went stale | GREEN | shipped #132 (Phase 5a); MS044 + `data/catalog-stats.json` make every count generated |
| doc-schema-url-release-bump | apps/site/src/content/docs/{schema,concepts,backend,adopt}.md, packages/surface-contracts/README.md, stability.md | the `@8.0/schema.json` URLs and the "current major 8.x" prose track the published package version; nothing regenerates them on a major bump | YELLOW | Phase 6d. Hand-bumped to `@9.0` / `9.x` as part of the release cut. A generated marker for these (the MS044 pattern) is a candidate v10 item. |
| push-readme-stale-install-pin | packages/push/README.md:16 | install command pinned `@5` for both packages, long past v5; surfaced by the Phase 6c five-agent audit | GREEN | fixed in the closure pass; pins dropped so the install line matches every other package README |

## S5. Branch posture

| branch | head | vs main | last activity | verdict | action |
| --- | --- | --- | --- | --- | --- |
| `main` | 66d5702 | base | 2026-05-20 | ACTIVE | base |
| `v9-closure-audit` | this commit | +1 (this refresh) | 2026-05-20 | ACTIVE | merge after Phase 6a |
| `changeset-release/main` | bot branch | the held "Version packages" PR (#121) | bot-managed | ACTIVE | merge at 6d to cut the 9.0 release |

Every v9 feature branch (`#115`-`#135`) is merged to `main`; no stale local branches remain that affect the release.

## Notes on how this refresh was produced

- S1 was refreshed from `ls packages/` and each `package.json`.
- S2 was derived from `data/traps.json`, `scripts/lib/check-registry.mjs`, `.github/workflows/ci.yml`, and `ls scripts/*.test.mjs`; the verdict column uses the closed TRAP vocabulary in `notes/audit-framework.md`.
- S3 claims were grepped from README, CLAUDE.md, AGENTS.md, the doc site, and package READMEs, and verified against the cited reality sources.
- S4 carries every prior id forward (slugs are stable) plus three new GREEN rows for the Phase 5 work and one open Phase 6d action.
- S5 was derived from `git branch -a`.
