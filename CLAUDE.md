<!--
  THIS FILE IS GENERATED. DO NOT EDIT.
  Source: data/traps.json (validated by packages/surface-contracts/src/traps.ts).
  Regenerate with: node --experimental-strip-types scripts/build-agents-md.mjs
  CI fails on drift via: pnpm surface:check
-->

# Mobile Surfaces: Invariants for AI Coding Assistants

This document lists the mandatory invariants enforced by Mobile Surfaces' test suite. Treat every `error` rule as a hard invariant; `pnpm surface:check` enforces them in CI. The catalog is generated from `data/traps.json`; edits go there, not to this file.

Mobile Surfaces is an Expo iOS reference architecture for Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets. iOS Live Activities silently fail: your code compiles, your push returns 200, and nothing appears on the Lock Screen. This catalog enumerates the failure modes that produce that silence and the checks the repo uses to surface them at PR time.

The per-rule Symptom and Fix prose lives in [`AGENTS.md`](./AGENTS.md); the index rows below link to its anchors. The raw source is [`data/traps.json`](./data/traps.json). CLAUDE.md is kept compact because Claude Code loads it into every conversation.

## Index

40 live rules: 35 error, 4 warning, 1 info. 3 retired ids reserved (see footnote).

| ID | Severity | Detection | Title |
| --- | --- | --- | --- |
| [MS001](AGENTS.md#ms001-live-activity-adapter-boundary) | error | static | Live Activity adapter boundary |
| [MS002](AGENTS.md#ms002-activitykit-attribute-file-byte-identity) | error | static | ActivityKit attribute file byte-identity |
| [MS003](AGENTS.md#ms003-swift-contentstate-fields-and-json-keys-match-zod-livesurfaceactivitycontentstate) | error | static | Swift ContentState fields and JSON keys match Zod liveSurfaceActivityContentState |
| [MS004](AGENTS.md#ms004-swift-stage-enum-cases-match-zod-livesurfacestage) | error | static | Swift Stage enum cases match Zod liveSurfaceStage |
| [MS006](AGENTS.md#ms006-generated-json-schema-must-match-zod-source) | error | static | Generated JSON Schema must match Zod source |
| [MS007](AGENTS.md#ms007-all-committed-fixtures-must-parse-as-livesurfacesnapshot) | error | static | All committed fixtures must parse as LiveSurfaceSnapshot |
| [MS008](AGENTS.md#ms008-snapshot-kind-must-match-its-projection-slice) | error | static | Snapshot kind must match its projection slice |
| [MS009](AGENTS.md#ms009-generated-typescript-fixtures-must-match-json-sources) | error | static | Generated TypeScript fixtures must match JSON sources |
| [MS011](AGENTS.md#ms011-activitykit-payload-size-ceiling-4-kb-5-kb-broadcast) | error | runtime | ActivityKit payload size ceiling (4 KB / 5 KB broadcast) |
| [MS012](AGENTS.md#ms012-ios-deployment-target-must-be-17-2-or-higher) | error | config | iOS deployment target must be 17.2 or higher |
| [MS013](AGENTS.md#ms013-app-group-entitlement-must-match-host-app-and-widget-extension) | error | static | App Group entitlement must match host app and widget extension |
| [MS014](AGENTS.md#ms014-apns-token-environment-must-match-the-build-environment) | error | runtime | APNs token environment must match the build environment |
| [MS016](AGENTS.md#ms016-subscribe-to-onpushtostarttoken-at-mount-not-on-demand) | error | runtime | Subscribe to onPushToStartToken at mount, not on demand |
| [MS017](AGENTS.md#ms017-apps-mobile-ios-is-generated-do-not-edit) | error | advisory | apps/mobile/ios/ is generated; do not edit |
| [MS018](AGENTS.md#ms018-apns-bundle-id-must-not-include-the-push-type-liveactivity-suffix) | error | runtime | APNS_BUNDLE_ID must not include the .push-type.liveactivity suffix |
| [MS020](AGENTS.md#ms020-per-activity-and-push-to-start-tokens-may-rotate-at-any-time) | error | runtime | Per-activity and push-to-start tokens may rotate at any time |
| [MS024](AGENTS.md#ms024-project-must-depend-on-mobile-surfaces-surface-contracts-and-push-when-sending) | error | config | Project must depend on @mobile-surfaces/surface-contracts (and push, when sending) |
| [MS025](AGENTS.md#ms025-app-group-declared-in-app-json) | error | config | App Group declared in app.json |
| [MS026](AGENTS.md#ms026-widget-target-managed-by-bacons-apple-targets) | error | config | Widget target managed by @bacons/apple-targets |
| [MS027](AGENTS.md#ms027-foreign-expo-project-must-target-ios-17-2-or-higher) | error | config | Foreign Expo project must target iOS 17.2 or higher |
| [MS028](AGENTS.md#ms028-apns-auth-key-environment-variables-must-be-set-before-sending) | error | runtime | APNs auth key environment variables must be set before sending |
| [MS029](AGENTS.md#ms029-generated-apps-mobile-ios-is-gitignored) | error | config | Generated apps/mobile/ios/ is gitignored |
| [MS030](AGENTS.md#ms030-apns-provider-token-must-be-valid-and-current) | error | runtime | APNs provider token must be valid and current |
| [MS031](AGENTS.md#ms031-channel-management-failures-missing-malformed-or-unregistered-channel-id) | error | runtime | Channel management failures (missing, malformed, or unregistered channel id) |
| [MS032](AGENTS.md#ms032-activity-timestamp-fields-must-be-valid-unix-seconds-integers) | error | runtime | Activity timestamp fields must be valid unix-seconds integers |
| [MS034](AGENTS.md#ms034-broadcast-capability-must-be-enabled-on-the-apns-auth-key) | error | runtime | Broadcast capability must be enabled on the APNs auth key |
| [MS035](AGENTS.md#ms035-apns-topic-header-missing-or-bundleid-misconfigured) | error | runtime | apns-topic header missing or bundleId misconfigured |
| [MS036](AGENTS.md#ms036-surface-snapshot-swift-structs-match-their-zod-projection-output-schemas) | error | static | Surface snapshot Swift structs match their Zod projection-output schemas |
| [MS037](AGENTS.md#ms037-notification-category-outputs-in-sync-with-canonical-registry) | error | static | Notification category outputs in sync with canonical registry |
| [MS038](AGENTS.md#ms038-live-activity-adapter-inputs-must-be-zod-parsed-before-crossing-the-bridge) | error | static | Live Activity adapter inputs must be Zod-parsed before crossing the bridge |
| [MS039](AGENTS.md#ms039-token-store-discipline-subscribe-to-activitykit-token-events-through-mobile-surfaces-tokens) | error | static | Token store discipline: subscribe to ActivityKit token events through @mobile-surfaces/tokens |
| [MS040](AGENTS.md#ms040-swift-trap-binding-file-byte-identity) | error | static | Swift trap-binding file byte-identity |
| [MS041](AGENTS.md#ms041-projection-output-envelopes-must-declare-schemaversion) | error | static | Projection-output envelopes must declare schemaVersion |
| [MS042](AGENTS.md#ms042-deprecation-prose-must-not-promise-removal-in-the-current-or-a-past-major) | error | static | Deprecation prose must not promise removal in the current or a past major |
| [MS043](AGENTS.md#ms043-changelog-entry-required-on-package-major) | error | static | CHANGELOG entry required on package major |
| [MS010](AGENTS.md#ms010-toolchain-preflight-node-24-pnpm-xcode-26) | warning | config | Toolchain preflight (Node 24, pnpm, Xcode 26+) |
| [MS015](AGENTS.md#ms015-push-priority-5-vs-10-budget-rules) | warning | runtime | Push priority 5 vs 10 budget rules |
| [MS021](AGENTS.md#ms021-discard-per-activity-tokens-when-the-activity-ends) | warning | runtime | Discard per-activity tokens when the activity ends |
| [MS023](AGENTS.md#ms023-per-activity-tokens-are-bound-to-a-single-activity-instance) | warning | runtime | Per-activity tokens are bound to a single Activity instance |
| [MS019](AGENTS.md#ms019-fb21158660-push-to-start-tokens-silent-after-force-quit) | info | advisory | FB21158660: push-to-start tokens silent after force-quit |

## Rules by tag

- `app-group`: MS013, MS025
- `channels`: MS031, MS034
- `cng`: MS017, MS029
- `config`: MS012, MS013, MS017, MS018, MS025, MS027, MS029, MS034, MS035, MS037, MS041, MS042, MS043
- `contract`: MS001, MS003, MS004, MS006, MS007, MS008, MS009, MS024, MS036, MS037, MS038, MS039, MS040, MS041, MS042, MS043
- `control`: MS013, MS026, MS036
- `ios-version`: MS012, MS027
- `ios18`: MS031, MS034
- `live-activity`: MS001, MS002, MS003, MS004, MS011, MS015, MS016, MS019, MS021, MS032, MS038, MS039
- `notification`: MS037
- `push`: MS006, MS011, MS014, MS015, MS018, MS024, MS028, MS030, MS031, MS032, MS034, MS035
- `swift`: MS002, MS003, MS004, MS036, MS040
- `tokens`: MS014, MS016, MS019, MS020, MS021, MS023, MS028, MS030, MS039
- `toolchain`: MS010, MS026
- `widget`: MS013, MS026, MS036

## Cross-references

Trap ids that describe the same constraint in two contexts, or the inverse failures of the same wire shape:

- **MS012 ↔ MS027** — iOS deployment target must be 17.2 or higher; Foreign Expo project must target iOS 17.2 or higher.
- **MS018 ↔ MS035** — APNS_BUNDLE_ID must not include the .push-type.liveactivity suffix; apns-topic header missing or bundleId misconfigured.

## How to use this document

- **When generating or editing code in a Mobile Surfaces project**, treat every `error` rule as a hard invariant. Do not bypass it; if your change requires breaking the invariant, surface that to the user and stop.
- **When auditing an existing project**, walk the index from top to bottom. Static rules can be checked by reading files; config rules by reading `app.json`, `package.json`, and `expo-target.config.js`; runtime rules by inspecting recent APNs response codes; advisory rules by reading the symptom and confirming the user has runbook coverage.
- **When suggesting fixes**, cite the rule id (e.g. `MS013`) so the user can trace the recommendation. The catalog id is stable across releases.
- **Source of truth.** This file is generated from `data/traps.json`. The long-form docs live on the live site at https://mobile-surfaces.com/docs; this catalog carries the action-oriented summary.

## Retired ids

Trap ids are monotonic forever; retired rules keep their id with a one-line tombstone here so external references (PR comments, log lines, blog posts) keep resolving to a known marker.

- **MS005** — Reserved id. The original rule was removed before its prose was preserved in git history; the id is held back so external references (PR comments, log lines, blog posts citing MS005) keep resolving to a known marker rather than collide with a future rule.
- **MS022** — Reserved id. The original rule was an early-draft duplicate of MS003 (Swift ContentState fields and JSON keys match Zod liveSurfaceActivityContentState) and was merged into it. See git commit d79ffb0.
- **MS033** — Reserved id. The original rule was removed before its prose was preserved in git history; the id is held back so external references (PR comments, log lines, blog posts citing MS033) keep resolving to a known marker rather than collide with a future rule.

## Related local documentation

- [Architecture](https://mobile-surfaces.com/docs/architecture): the contract, the surfaces, the adapter boundary.
- [Multi-surface](https://mobile-surfaces.com/docs/multi-surface): every `kind` value and the projection it drives.
- [Backend integration](https://mobile-surfaces.com/docs/backend-integration): domain event to snapshot to APNs walkthrough.
- [Push](https://mobile-surfaces.com/docs/push): wire-layer reference, SDK, smoke script, token taxonomy, error reasons.
- [Observability](https://mobile-surfaces.com/docs/observability): which catalog-bound errors are worth alerting on, what a stuck Live Activity looks like on the wire, recommended log shape.
- [Troubleshooting](https://mobile-surfaces.com/docs/troubleshooting): symptom-to-fix recipes for failures not in this catalog.
- [Trap catalog maintenance](https://mobile-surfaces.com/docs/traps): schema and workflow for editing this catalog.

