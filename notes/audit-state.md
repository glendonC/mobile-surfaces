---
audit-date: 2026-05-17
branch: audit/v8-framework
audit-target: v8 working tree at HEAD = main + audit/v8-framework
prior-audit: none (this is the first baseline)
framework-version: notes/audit-framework.md
---

# Audit State: v8 baseline

Filled per `notes/audit-framework.md`. The diff against the previous version of this file is the audit report.

## S1. Packages

| name | version | bin declared | bin exists | files declared exist | README matches code | known bugs | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `create-mobile-surfaces` | 7.1.0 | `mobile-surfaces:./bin/mobile-surfaces.mjs`, `create-mobile-surfaces:./bin/index.mjs` | `mobile-surfaces` bin MISSING | yes | README omits the `audit` subcommand entirely | `package.json:30` bin entry has no file; install via `npm i -g` ships broken symlink; `audit` subcommand has no entrypoint, no tests, walks paths not in published tarball | BROKEN |
| `@mobile-surfaces/example-domain` | 0.1.1 | n/a | n/a | yes | yes | none recorded | SHIP |
| `@mobile-surfaces/live-activity` | 7.1.0 | n/a | n/a | yes | NO - three documented behaviors contradict shipped code | README claims `getPushToStartToken()` returns null (false, caches at `ObserverRegistry.swift:71-73`); claims no payload validation (false, MS038 at `src/index.ts:214-222`); claims no `relevanceScore` (false, threaded JS-to-Swift at `src/index.ts:49-52`) | DEGRADED |
| `@mobile-surfaces/push` | 7.1.0 | n/a | n/a | yes | yes | `#retryPolicy` deprecation warn uses module-global flag (`src/client.ts:547`); FNV-1a hash fallback silently engages without surfacing to caller (`src/hash.ts:58-71`) | SHIP |
| `@mobile-surfaces/surface-contracts` | 8.0.0 | n/a | n/a | yes | yes | `z.lazy()` wrapper on main union (`schema.ts:514-522`) - misleading rationale; four hand-maintained Codable structs at `MobileSurfacesSharedState.swift:296-320` inconsistent with "Zod is the source of truth" framing | SHIP |
| `@mobile-surfaces/tokens` | 7.1.0 | n/a | n/a | yes | yes | hydration write-loss race (`src/index.ts:129-149` + `~:172`); forwarder backoff off-by-one vs push retry (`src/forwarder.ts:103-113` vs `:251`); duplicates push retry shape that could be shared | DEGRADED |
| `@mobile-surfaces/traps` | 8.0.0 | n/a | n/a | yes | yes | deliberate no-Zod-import constraint is documented (`packages/traps/src/index.ts` header) | SHIP |
| `@mobile-surfaces/validators` | 8.0.0 | n/a | n/a | yes | yes | thin regex coverage - no reserved-bundle-id checks, no length caps, no Unicode normalization, no clash detection with template defaults (`packages/validators/src/index.mjs`) | DEGRADED |

## S2. Trap catalog

40 live rules + 3 retired. `in-registry` and `has-test` are tri-state (yes / no / n/a-for-retired).

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
| MS009 | error | static | generate-surface-fixtures.mjs (with `--check`) | yes | yes | no | PR-ENFORCED | |
| MS010 | warning | config | doctor.mjs | yes | yes | no | PR-ENFORCED | warning severity |
| MS011 | error | runtime | n/a (SDK preflight) | n/a | n/a | yes (push) | RUNTIME-SDK | `packages/push/src/preflight.ts:20-49` |
| MS012 | error | config | probe-app-config.mjs | yes | yes | no | PR-ENFORCED | DUPLICATE with MS027 - both fire the same deployment-target check |
| MS013 | error | static | check-app-group-identity.mjs | yes | yes | yes | PR-ENFORCED | |
| MS014 | error | runtime | n/a | n/a | n/a | no | DOC-ONLY | typed error exists (`BadDeviceTokenError`) but no static or preflight check that token environment matches build environment |
| MS015 | warning | runtime | n/a | n/a | n/a | no | RUNTIME-SDK | `TooManyRequestsError` typed |
| MS016 | error | runtime | n/a | n/a | n/a | no | DOC-ONLY | "subscribe to onPushToStartToken at mount" - no enforcement at any layer |
| MS017 | error | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | advisory by design ("apps/mobile/ios/ is generated, do not edit") |
| MS018 | error | runtime | n/a | no | n/a | no | RUNTIME-SDK | DUPLICATE with MS035; `probe-app-config.mjs` partially mitigates by checking `app.json` bundleId shape but the env var itself is unchecked; typed `TopicDisallowedError` |
| MS019 | info | advisory | n/a | n/a | n/a | n/a | DOC-ONLY | FB21158660 advisory |
| MS020 | error | runtime | n/a | n/a | n/a | no | DOC-ONLY | typed `UnregisteredError` but pure rotation docs |
| MS021 | warning | runtime | n/a | n/a | n/a | no | DOC-ONLY | warning sev, no errorClasses |
| MS022 | info | advisory | n/a | n/a | n/a | n/a | RETIRED | merged into MS003 |
| MS023 | warning | runtime | n/a | n/a | n/a | no | DOC-ONLY | warning sev, no errorClasses |
| MS024 | error | config | probe-app-config.mjs | yes | yes | no | PR-ENFORCED | |
| MS025 | error | config | probe-app-config.mjs | yes | yes | no | PR-ENFORCED | |
| MS026 | error | config | n/a | no | yes | no | WARN-ONLY | `probe-app-config.mjs:206-218` emits a warning bound to MS026 if `expo-target.config.js` is missing but does not fail the build; catalog severity is `error` - catalog-vs-enforcement drift |
| MS027 | error | config | probe-app-config.mjs | yes | yes | no | PR-ENFORCED | DUPLICATE with MS012 |
| MS028 | error | runtime | construction-time throw | n/a | n/a | yes (push) | RUNTIME-SDK | `MissingApnsConfigError` at `createPushClient` |
| MS029 | error | config | check-ios-gitignore.mjs | yes | yes | yes | PR-ENFORCED | |
| MS030 | error | runtime | n/a | n/a | n/a | yes (push errors) | RUNTIME-SDK | typed errors per reason class |
| MS031 | error | runtime | n/a | n/a | n/a | yes (push channels) | RUNTIME-SDK | three typed channel errors |
| MS032 | error | runtime | n/a (SDK preflight) | n/a | n/a | yes (push) | RUNTIME-SDK | `packages/push/src/preflight.ts:56-181` |
| MS033 | info | advisory | n/a | n/a | n/a | n/a | RETIRED | id reserved |
| MS034 | error | runtime | n/a | n/a | n/a | no | DOC-ONLY | typed `FeatureNotEnabledError` but only fires on 403 |
| MS035 | error | runtime | n/a | n/a | n/a | no | RUNTIME-SDK | DUPLICATE with MS018; typed `MissingTopicError`; SDK construction-time |
| MS036 | error | static | check-surface-snapshots.mjs | yes | yes | yes | PR-ENFORCED | |
| MS037 | error | static | generate-notification-categories.mjs (with `--check`) | yes | yes | no | PR-ENFORCED | |
| MS038 | error | static | check-adapter-parses.mjs | yes | yes | no | PR-ENFORCED | grep-based |
| MS039 | error | static | check-token-discipline.mjs | yes | yes | no | PR-ENFORCED | grep-based |
| MS040 | error | static | check-traps-swift-byte-identity.mjs | yes | yes | no | PR-ENFORCED | |
| MS041 | error | static | check-projection-envelope-version.mjs | yes | yes | no | PR-ENFORCED | "first-property ordering" sub-rule is theatrical; literal sub-rule is real |
| MS042 | error | static | check-deprecation-prose.mjs | yes | yes | yes | PR-ENFORCED | |
| MS043 | error | static | check-changelog-on-major.mjs | yes | yes | no | PR-ENFORCED | |

### S2 totals (live rules; totals must sum to 40)

- PR-ENFORCED: 23 (MS001-004, MS006-010, MS012-013, MS024-025, MS027, MS029, MS036-043)
- RUNTIME-SDK: 8 (MS011, MS015, MS018, MS028, MS030-032, MS035)
- WARN-ONLY: 1 (MS026)
- DOC-ONLY: 8 (MS014, MS016, MS017, MS019, MS020, MS021, MS023, MS034)
- Sum: 23 + 8 + 1 + 8 = 40 ✓
- Retired (excluded from totals): 3 (MS005, MS022, MS033)
- DUPLICATE pairs: MS012/MS027 (deployment-target check), MS018/MS035 (apns-topic / bundle-id suffix)

Headline arithmetic for the README/CLAUDE.md "35 error rules" claim:

| breakdown | count |
| --- | --- |
| error-severity rules in catalog | 35 |
| of which PR-ENFORCED | 22 (excludes MS010 which is warning sev) |
|   minus 1 duplicate (MS027 = MS012) | 21 distinct |
| of which RUNTIME-SDK | 7 (excludes MS015 warning sev) |
|   minus 1 duplicate (MS035 = MS018) | 6 distinct |
| of which WARN-ONLY | 1 (MS026) |
| of which DOC-ONLY | 5 (MS014, MS016, MS017, MS020, MS034) |
| **distinct error rules PR-gated at build time** | **21** |
| **error rules with no PR gate and no SDK enforcement** | **6** (5 DOC-ONLY + 1 WARN-ONLY) |

The headline number for honest public claims is **21 PR-gated error conditions** (not 35, not 29, not "35 enforced in CI"). Use "40 documented failure modes, 21 PR-gated, 6 SDK-runtime-enforced, 8 advisory + warning" if a more granular breakdown is wanted.

## S3. Public claims

| source | claim | reality source | verdict | notes |
| --- | --- | --- | --- | --- |
| `CLAUDE.md:13` | "40 live rules: 35 error, 4 warning, 1 info. 3 retired" | data/traps.json (verified) | MATCHES | |
| `CLAUDE.md:6` | "`pnpm surface:check` enforces them in CI" (referring to error rules) | scripts/lib/check-registry.mjs + .github/workflows/ci.yml | OVERSTATES | only ~22 of 35 error rules are PR-gated; rest are RUNTIME-SDK / DOC-ONLY |
| `apps/site/src/components/Island.astro:25` | "A complete iPhone surface starter. You get Live Activities, Dynamic Island, widgets, and controls set up end to end" | notes/positioning.md:122 ("we are not 'better than expo-live-activity'. We are the layer they don't ship.") | STALE | site uses retired "starter" framing while internal positioning has moved to "wire format above the bridge" |
| `packages/create-mobile-surfaces/package.json:4` (description) | "Also ships the `mobile-surfaces audit` subcommand for checking foreign Expo projects against the trap catalog" | `ls packages/create-mobile-surfaces/bin/` (only `index.mjs`) | LIES | bin file does not exist; `src/audit.mjs` exists but has no entrypoint |
| `packages/create-mobile-surfaces/package.json:30` | bin entry `"mobile-surfaces": "./bin/mobile-surfaces.mjs"` | filesystem | LIES | file does not exist; `npm i -g` ships broken symlink |
| `packages/live-activity/README.md:~60` | "`getPushToStartToken()` always resolves null today; iOS does not expose a synchronous query" | `ios/LiveActivityModule.swift:147-150`, `ios/ObserverRegistry.swift:71-73` | LIES | Swift caches latest emission and returns it |
| `packages/live-activity/README.md:~85` | "No payload validation" | `src/index.ts:214-222` (MS038 enforced) | LIES | adapter Zod-parses inputs before crossing bridge |
| `packages/live-activity/README.md:~88` | "No `relevanceScore`" | `src/index.ts:49-52`, `client.ts:240`, `LiveActivityModule.swift:311-326` | LIES | threaded JS to Swift |
| `apps/site/src/content/docs/adopt.md:63` | JSON Schema URL `...@7.0/schema.json` | `packages/surface-contracts/schema.json` `$id` is `@8.0/schema.json` | STALE | URL pin drift (wire schemaVersion 5 is correct; the URL pin is the stale part) |
| `apps/site/src/content/docs/schema.md:60,63,123` | URLs and prose say `@7.0`; "Pinning to `7.0` rather than `7`..." | actual `$id` is `@8.0`; internally inconsistent with `:9` and `:123` which already say `@8.0` | STALE | URL pin drift within a single file |
| `apps/site/src/content/docs/concepts.md:208` | `$id` derivation example shows `...@7.0/schema.json` | actual schema `$id` is `@8.0` | STALE | URL pin drift |
| `apps/site/src/content/docs/backend.md:146` | "published JSON Schema at `unpkg.com/@mobile-surfaces/surface-contracts@5.0/schema.json`" | actual `$id` is `@8.0` | STALE | URL pin drift (3 majors behind) |
| `notes/roadmap.md:30` | JSON Schema URL `@7.0/schema.json` | actual `$id` is `@8.0` | STALE | internal note; same drift class |
| `apps/site/src/content/docs/vs-expo-live-activity.md:75` | "29 of those rules are statically enforced by scripts in `surface:check`" | S2 totals: 21 distinct PR-gated error rules; 24 static+config total | OVERSTATES | |
| `apps/site/src/content/docs/vs-expo-live-activity.md:25` and `README.md:16` | "40 documented iOS silent-failure modes ... enforced in CI" | S2 totals: 21 PR-gated error rules; 40 is the documented-mode count but "enforced in CI" overstates | OVERSTATES | |
| `apps/site/src/content/docs/vs-expo-live-activity.md:73` | "ES256 JWT signing with a 60-minute key rotation" | `apps/site/src/content/docs/push.md:386` and `packages/push/README.md:199` both say 50 minutes | LIES | internal contradiction on a load-bearing security number |
| `apps/site/src/content/docs/building-your-app.md:43,199`, `quickstart.md:113`, `scenarios.md:8` | "all five surfaces" / "five pre-projected outputs, one per surface kind" | `packages/surface-contracts/src/schema.ts:46-54` enumerates SIX kinds (`liveActivity`, `widget`, `control`, `lockAccessory`, `standby`, `notification`) | LIES | doc drift after `notification` kind landed |
| `packages/push/README.md:19` | "Surface contracts and push release together in the v5 linked group" | per `apps/site/src/content/docs/stability.md:26-32`, linked group is `surface-contracts + validators + traps`; push versions independently | LIES | |
| `packages/example-domain/README.md:5,13,38` | "stable across the v5 schema generation" / "every snapshot kind v5 ships" | surface-contracts is at 8.0.0; wire schemaVersion is "5" but "v5 schema generation" phrasing reads as the package version | STALE | ambiguous prose; either rewrite as "schemaVersion 5" or bump |
| `apps/site/src/components/Island.astro:123,215` | "The fastest way to ship Live Activities..." | no benchmark anywhere in repo; superlative is unsubstantiated and conflicts with the brand-voice "declarative and clean, no jokey" preference | OVERSTATES | |
| `apps/site/src/components/Island.astro:32` | "Run the install command, follow the wizard, and a Live Activity shows up on your simulator" | `packages/create-mobile-surfaces/README.md:81` requires Xcode 26+, iOS 17.2 sim runtime, pnpm, CocoaPods; not single-command | OVERSTATES | |
| `apps/site/src/content/docs/push.md:380` | "Sixteen of the error classes are catalog-bound ... mapping to eleven distinct trap ids" | precise count not verified inline against `packages/push/src/reasons.ts` `trapIdForErrorClass` | STALE-RISK | needs reality-check against reasons.ts |
| `packages/live-activity/README.md:13` | "Requires Expo SDK 55+, React Native 0.83+, React 19.2+" | precise floor claims not verified against `peerDependencies` | STALE-RISK | |
| `README.md:15` | "typed errors for every documented APNs reason" | universal quantifier not verified against `reasons.ts` | STALE-RISK | |
| `notes/positioning.md:55` | "Our bridge has roughly one user (us)" | README + landing | MATCHES (internally), STALE (externally - not surfaced in user-facing copy) | |
| `packages/create-mobile-surfaces/README.md:63-75` | five-value exit code contract | `test/exit-codes.test.mjs` (229 LOC) | MATCHES | pinned by tests |
| `CLAUDE.md:1` indirect | "test suite enforces every error rule" (paraphrased framing) | per S2 grid | OVERSTATES | same as row 2 above |

## S4. Cross-cutting findings

| id | file:line | issue | severity | task-ref |
| --- | --- | --- | --- | --- |
| cli-bin-missing | packages/create-mobile-surfaces/package.json:30 | declared bin file does not exist | RED | #2 |
| tokens-hydration-race | packages/tokens/src/index.ts:129-149 | upsert during hydration window silently never persists | RED | #3 |
| live-activity-readme-lies | packages/live-activity/README.md | three contradictions vs shipped code | RED | #4 |
| forwarder-off-by-one | packages/tokens/src/forwarder.ts:103-113 vs :251 | backoff math diverges from push retry shape it claims to mirror | YELLOW | #5 |
| ms026-catalog-drift | data/traps.json MS026 + scripts/probe-app-config.mjs:206-218 | severity error but only warn-emits, no registry binding | YELLOW | #6 |
| ms014-ms016-ms020-ms034-ms035-doc-only | data/traps.json | error severity with zero enforcement at any layer | YELLOW | #6 |
| ms012-ms027-duplicate | data/traps.json + probe-app-config.mjs | same condition counted twice | YELLOW | #6 |
| ms041-ordering-theatrical | scripts/check-projection-envelope-version.mjs:103-104 | "first-property" rule protects a Swift probe that uses key-based Codable decoding | YELLOW | #7 |
| swift-shared-state-handwritten | apps/mobile/targets/_shared/MobileSurfacesSharedState.swift:296-320 | four Codable structs hand-maintained while ActivityAttributes is generated; architectural inconsistency | YELLOW | #7 |
| zod-internals-reach | scripts/check-activity-attributes.mjs:271-278 | reaches into `_zod.def` / `def.entries`; couples CI gate to Zod internal repr | YELLOW | #7 |
| z-lazy-premature-opt | packages/surface-contracts/src/schema.ts:514-522 | `z.lazy()` wrapper with misleading rationale | YELLOW | #7 |
| validators-thin | packages/validators/src/index.mjs | regex coverage only; no reserved-id, length, normalization, clash checks | YELLOW | #9 |
| snapshot-tests-partially-circular | packages/create-mobile-surfaces/test/snapshot-scaffold.test.mjs:108-145 | exclude list defeats CLI-logic regression detection | YELLOW | #9 |
| schema-url-drift-fanout | adopt.md:63, schema.md:60-63, concepts.md:208, backend.md:146, roadmap.md:30 | URL pin `@7.0` (or `@5.0` in backend.md) vs actual `$id` `@8.0`; drift spans 5 files including one internal contradiction inside schema.md | RED | #11 |
| jwt-rotation-doc-contradiction | vs-expo-live-activity.md:73 (60 min) vs push.md:386 + push/README.md:199 (50 min) | load-bearing security number contradicts itself across public docs | RED | #11 |
| five-vs-six-surfaces-doc-drift | building-your-app.md:43,199 + quickstart.md:113 + scenarios.md:8 | docs say "five surfaces"; schema ships six (`notification` added) | YELLOW | #11 |
| push-linked-group-misclaim | packages/push/README.md:19 | claims push is in a "v5 linked group"; actual linked group is contracts+validators+traps, push is independent | YELLOW | #11 |
| fastest-superlative-unsubstantiated | apps/site/src/components/Island.astro:123,215 | "fastest way to ship" with no benchmark; conflicts with brand-voice memory | YELLOW | #8 |
| site-starter-vs-wire-format | apps/site/src/components/Island.astro:25 | site copy still says "starter" while positioning has moved | YELLOW | #8 |
| readme-headline-overstate | README.md + CLAUDE.md "35 invariants enforced at PR time" | actual distinct PR-gated count is 21 (per S2 totals) | YELLOW | #6 / #8 |
| one-maintainer-undisclosed | README, landing | no "single-maintainer reference architecture" disclosure | YELLOW | #8 |
| doc-surface-bloat | apps/site/src/content/docs/**, notes/ | 4500+ lines for ~3 published packages | YELLOW | #8 |
| push-error-class-count-unverified | apps/site/src/content/docs/push.md:380 | "16 catalog-bound error classes mapping to 11 distinct trap ids" - precise number never reality-checked against packages/push/src/reasons.ts trapIdForErrorClass | YELLOW | #6 |
| live-activity-peer-floor-unverified | packages/live-activity/README.md:13 | "Expo SDK 55+, RN 0.83+, React 19.2+" not verified against peerDependencies | YELLOW | #8 |
| typed-errors-every-claim-unverified | README.md:15 | "typed errors for every documented APNs reason" - universal quantifier not verified | YELLOW | #6 |
| push-retrypolicy-warn-global | packages/push/src/client.ts:547 | module-global flag suppresses across PushClient instances | GREEN | (acknowledged in code comment) |
| push-hash-fallback | packages/push/src/hash.ts:58-71 | FNV-1a silently engages, pads to 64 hex; consumer can't tell | GREEN | (acknowledged) |

## S5. Branch posture

| branch | head | vs main | last activity | verdict | action |
| --- | --- | --- | --- | --- | --- |
| `main` | 913121d | base | 2026-05-17 | ACTIVE | base |
| `audit/v8-framework` | this commit | +1 docs ahead | 2026-05-17 | ACTIVE | merge after Phase 0 validation |
| `fix/relax-close-test-libuv-quantization` | 5de2091 | +2 (1 unpushed) | 2026-05-17 | ACTIVE | user's in-flight docs cleanup; do not touch |
| `fix/release-version-regen-scaffold-snapshots` | (remote present) | merged via #84 | superseded | MERGED | prune local |
| `hotfix/cancel-stale-v7-changeset` | merged via #80 | merged | superseded | MERGED | prune local |
| `hotfix/concurrency-test-listener-hygiene` | merged via #79 | merged | superseded | MERGED | prune local |
| `hotfix/extend-retrypolicy-deprecation-window` | merged via #83 | merged | superseded | MERGED | prune local |
| `hotfix/monotonic-close-timer` | merged via #81 | merged | superseded | MERGED | prune local |
| `hotfix/relax-elapsed-ms-test-bound` | merged via #82 | merged | superseded | MERGED | prune local |
| `refactor/v5-foundation` | historic | merged historically | STALE | STALE | prune local |
| `refactor/v8` | historic | merged via v8 cuts | STALE | STALE | prune local |
| `refactor/v8-example-backend` | merged via #78 | merged | STALE | MERGED | prune local |
| `refactor/v8-push` | merged via #77 | merged | STALE | MERGED | prune local |
| `changeset-release/main` | bot branch | tracks bot | bot-managed | ACTIVE | leave to bot |

## Notes on how this baseline was produced

- All 5 sections were filled from a single working tree at `audit/v8-framework` HEAD = `main` + this file.
- S2 cells were derived from `data/traps.json` + `scripts/lib/check-registry.mjs` + `.github/workflows/ci.yml` + `ls scripts/check-*.test.mjs`.
- S3 claims were pulled from prior five-agent audit reports and verified individually against the cited file:line evidence.
- S4 ids are designed to be stable across audits - same slug for the same finding.
- S5 was derived from `git branch -a` and recent commit history on main.
