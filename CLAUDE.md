<!--
  THIS FILE IS GENERATED. DO NOT EDIT.
  Source: data/traps.json (validated by packages/surface-contracts/src/traps.ts).
  Regenerate with: node --experimental-strip-types scripts/build-agents-md.mjs
  CI fails on drift via: pnpm surface:check
-->

# Mobile Surfaces: Invariants for AI Coding Assistants

This document is the load-bearing summary of every silent-failure trap, contract invariant, and platform constraint that AI coding assistants need to respect when working in a Mobile Surfaces project. It is generated from `data/traps.json`. Edits go to the catalog, not to this file.

Mobile Surfaces is an Expo iOS reference architecture for Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets. The pitch: iOS Live Activities silently fail. Your code compiles, your push returns 200, and nothing appears on the Lock Screen. This catalog is the working baseline past the traps that cost most teams a week of debugging.

## Index

29 rules total: 24 error, 4 warning, 1 info.

| ID | Severity | Detection | Title |
| --- | --- | --- | --- |
| [MS001](#ms001-live-activity-adapter-boundary) | error | static | Live Activity adapter boundary |
| [MS002](#ms002-activitykit-attribute-file-byte-identity) | error | static | ActivityKit attribute file byte-identity |
| [MS003](#ms003-swift-contentstate-fields-match-zod-livesurfaceactivitycontentstate) | error | static | Swift ContentState fields match Zod liveSurfaceActivityContentState |
| [MS004](#ms004-swift-stage-enum-cases-match-zod-livesurfacestage) | error | static | Swift Stage enum cases match Zod liveSurfaceStage |
| [MS005](#ms005-validator-regex-parity-between-rename-and-cli-scaffolder) | error | static | Validator regex parity between rename and CLI scaffolder |
| [MS006](#ms006-generated-json-schema-must-match-zod-source) | error | static | Generated JSON Schema must match Zod source |
| [MS007](#ms007-all-committed-fixtures-must-parse-as-livesurfacesnapshot) | error | static | All committed fixtures must parse as LiveSurfaceSnapshot |
| [MS008](#ms008-snapshot-kind-must-match-its-projection-slice) | error | static | Snapshot kind must match its projection slice |
| [MS009](#ms009-generated-typescript-fixtures-must-match-json-sources) | error | static | Generated TypeScript fixtures must match JSON sources |
| [MS011](#ms011-activitykit-payload-size-ceiling-4-kb-5-kb-broadcast) | error | runtime | ActivityKit payload size ceiling (4 KB / 5 KB broadcast) |
| [MS012](#ms012-ios-deployment-target-must-be-17-2-or-higher) | error | config | iOS deployment target must be 17.2 or higher |
| [MS013](#ms013-app-group-entitlement-must-match-host-app-and-widget-extension) | error | config | App Group entitlement must match host app and widget extension |
| [MS014](#ms014-apns-token-environment-must-match-the-build-environment) | error | runtime | APNs token environment must match the build environment |
| [MS016](#ms016-subscribe-to-onpushtostarttoken-at-mount-not-on-demand) | error | static | Subscribe to onPushToStartToken at mount, not on demand |
| [MS017](#ms017-apps-mobile-ios-is-generated-do-not-edit) | error | static | apps/mobile/ios/ is generated; do not edit |
| [MS018](#ms018-apns-bundle-id-must-not-include-the-push-type-liveactivity-suffix) | error | runtime | APNS_BUNDLE_ID must not include the .push-type.liveactivity suffix |
| [MS020](#ms020-per-activity-and-push-to-start-tokens-may-rotate-at-any-time) | error | static | Per-activity and push-to-start tokens may rotate at any time |
| [MS022](#ms022-activitykit-content-state-json-keys-must-match-swift-contentstate) | error | static | ActivityKit content-state JSON keys must match Swift ContentState |
| [MS024](#ms024-project-must-depend-on-mobile-surfaces-surface-contracts-and-push-when-sending) | error | config | Project must depend on @mobile-surfaces/surface-contracts (and push, when sending) |
| [MS025](#ms025-app-group-declared-in-app-json) | error | config | App Group declared in app.json |
| [MS026](#ms026-widget-target-managed-by-bacons-apple-targets) | error | config | Widget target managed by @bacons/apple-targets |
| [MS027](#ms027-foreign-expo-project-must-target-ios-17-2-or-higher) | error | config | Foreign Expo project must target iOS 17.2 or higher |
| [MS028](#ms028-apns-auth-key-environment-variables-must-be-set-before-sending) | error | runtime | APNs auth key environment variables must be set before sending |
| [MS029](#ms029-generated-apps-mobile-ios-is-gitignored) | error | config | Generated apps/mobile/ios/ is gitignored |
| [MS010](#ms010-toolchain-preflight-node-24-pnpm-xcode-26) | warning | config | Toolchain preflight (Node 24, pnpm, Xcode 26+) |
| [MS015](#ms015-push-priority-5-vs-10-budget-rules) | warning | runtime | Push priority 5 vs 10 budget rules |
| [MS021](#ms021-discard-per-activity-tokens-when-the-activity-ends) | warning | runtime | Discard per-activity tokens when the activity ends |
| [MS023](#ms023-per-activity-tokens-are-bound-to-a-single-activity-instance) | warning | runtime | Per-activity tokens are bound to a single Activity instance |
| [MS019](#ms019-fb21158660-push-to-start-tokens-silent-after-force-quit) | info | advisory | FB21158660: push-to-start tokens silent after force-quit |

## Rules by tag

- `app-group`: MS013, MS025
- `cng`: MS017, MS029
- `config`: MS012, MS013, MS017, MS018, MS025, MS027, MS029
- `contract`: MS001, MS003, MS004, MS005, MS006, MS007, MS008, MS009, MS022, MS024
- `control`: MS013, MS026
- `ios-version`: MS012, MS027
- `live-activity`: MS001, MS002, MS003, MS004, MS011, MS015, MS016, MS019, MS021, MS022
- `push`: MS006, MS011, MS014, MS015, MS018, MS024, MS028
- `swift`: MS002, MS003, MS004, MS022
- `tokens`: MS014, MS016, MS019, MS020, MS021, MS023, MS028
- `toolchain`: MS005, MS010, MS026
- `widget`: MS013, MS026

## How to use this document

- **When generating or editing code in a Mobile Surfaces project**, treat every `error` rule as a hard invariant. Do not bypass it; if your change requires breaking the invariant, surface that to the user and stop.
- **When auditing an existing project**, walk the index from top to bottom. Static rules can be checked by reading files; config rules by reading `app.json`, `package.json`, and `expo-target.config.js`; runtime rules by inspecting recent APNs response codes; advisory rules by reading the symptom and confirming the user has runbook coverage.
- **When suggesting fixes**, cite the rule id (e.g. `MS013`) so the user can trace the recommendation. The catalog id is stable across releases.
- **Source of truth.** This file is generated from `data/traps.json`. Local docs in `docs/` carry the long-form story; this catalog carries the action-oriented summary.

## Rules

### MS001: Live Activity adapter boundary

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, contract  •  **enforced by:** `scripts/check-adapter-boundary.mjs`

Application code under apps/*/src/ must import the live-activity adapter through the boundary re-export, never directly from @mobile-surfaces/live-activity.

**Symptom.** Compile-time imports look fine, but the project loses the swap point for switching to expo-live-activity, expo-widgets, or a custom native module without touching call sites.

**Fix.** Import from apps/mobile/src/liveActivity (the boundary re-export) instead of @mobile-surfaces/live-activity directly. Add new methods to the adapter contract first, not at the call site.

**See:** `docs/architecture.md#adapter-contract`

### MS002: ActivityKit attribute file byte-identity

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, swift  •  **enforced by:** `scripts/check-activity-attributes.mjs`

MobileSurfacesActivityAttributes.swift in packages/live-activity/ios/ and apps/mobile/targets/widget/ must be byte-identical.

**Symptom.** Activity starts on the device but never appears on the Lock Screen. No log, no error. ActivityKit silently drops updates whose decoded ContentState shape does not match the widget extension's struct.

**Fix.** Edit one file and copy verbatim into the other; pnpm surface:check verifies byte-identity. Phase 5 will replace this duplication with a local Swift Package once @bacons/apple-targets and React Native lift the upstream blocks.

**See:** `docs/architecture.md#native-constraints`

### MS003: Swift ContentState fields match Zod liveSurfaceActivityContentState

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, swift, contract  •  **enforced by:** `scripts/check-activity-attributes.mjs`

Field names and types in MobileSurfacesActivityAttributes.ContentState must match liveSurfaceActivityContentState in packages/surface-contracts/src/schema.ts.

**Symptom.** Push lands but the Lock Screen view stays on its old state because the Codable decoder silently fails on a renamed key.

**Fix.** Update the Zod source first, regenerate the JSON Schema (pnpm surface:check), and mirror the field change into both Swift attribute files.

### MS004: Swift Stage enum cases match Zod liveSurfaceStage

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, swift, contract  •  **enforced by:** `scripts/check-activity-attributes.mjs`

The Stage enum in MobileSurfacesActivityAttributes.swift must cover exactly the cases listed in liveSurfaceStage.

**Symptom.** ContentState decodes but the stage value falls back to a default. Your Lock Screen never shows 'completing' even after the job is done.

**Fix.** Add or remove cases in lockstep: Zod first, regenerate the schema, mirror into both Swift files.

### MS005: Validator regex parity between rename and CLI scaffolder

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** contract, toolchain  •  **enforced by:** `scripts/check-validator-sync.mjs`

scripts/rename-starter.mjs and the create-mobile-surfaces CLI must share identical projectSlug, scheme, and bundleId regexes.

**Symptom.** An identifier accepted at scaffold time is rejected by surface:rename later, or vice versa, and users hit it after they have committed work.

**Fix.** Update both regexes in lockstep. The drift check covers projectSlug, scheme, and bundleId.

### MS006: Generated JSON Schema must match Zod source

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** contract, push  •  **enforced by:** `scripts/build-schema.mjs`

packages/surface-contracts/schema.json must be regenerated whenever the Zod source changes; CI fails if the committed file is stale.

**Symptom.** Backends validating with Ajv or jsonschema accept payloads the runtime then rejects (or vice versa). Consumers pinning the unpkg URL get out-of-date validation.

**Fix.** Run node --experimental-strip-types scripts/build-schema.mjs and commit the result.

### MS007: All committed fixtures must parse as LiveSurfaceSnapshot

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** contract  •  **enforced by:** `scripts/validate-surface-fixtures.mjs`

Every JSON file under data/surface-fixtures/ must parse via the v1 discriminated union (after $schema is stripped).

**Symptom.** Tests that exercise fixtures pass locally but fail in CI on a fixture nobody noticed was malformed; or fixture-driven previews silently render placeholder data.

**Fix.** Run pnpm surface:check and address any reported issues. Update data/surface-fixtures/index.json if the fixture was newly added.

### MS008: Snapshot kind must match its projection slice

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** contract  •  **enforced by:** `scripts/surface-contracts.test.mjs`

kind: 'widget' requires a widget slice; kind: 'control' requires a control slice; kind: 'notification' requires a notification slice.

**Symptom.** safeParse throws a discriminated-union error at the wire boundary; or worse, an old code path bypasses safeParse and a missing slice causes downstream surfaces to render placeholder data.

**Fix.** Pair every kind change with its slice. Use the projection helper for the kind (toWidgetTimelineEntry, toControlValueProvider, toNotificationContentPayload) rather than reaching into the snapshot directly.

### MS009: Generated TypeScript fixtures must match JSON sources

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** contract  •  **enforced by:** `scripts/generate-surface-fixtures.mjs`

packages/surface-contracts/src/fixtures.ts is generated from data/surface-fixtures/*.json and must not drift.

**Symptom.** Test imports reference the TS fixtures but get a stale shape; the harness shows different state than the fixture file on disk.

**Fix.** Run node scripts/generate-surface-fixtures.mjs and commit. CI runs the same with --check.

### MS011: ActivityKit payload size ceiling (4 KB / 5 KB broadcast)

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** live-activity, push  •  **ios min:** 16.2

Per-activity Live Activity pushes are bounded at 4 KB; iOS 18 broadcast pushes at 5 KB.

**Symptom.** APNs returns 413 PayloadTooLarge, or accepts the payload but iOS silently drops the update. Long localized strings or accumulated morePartsCount details are common offenders.

**Fix.** Trim the snapshot. Shorten secondaryText, lower morePartsCount, or split a state into two smaller pushes. Validate by sending the projection through toLiveActivityContentState and measuring.

**See:** `docs/push.md#error-responses`

**Apple docs:** [ref 1](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)

### MS012: iOS deployment target must be 17.2 or higher

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** ios-version, config  •  **ios min:** 17.2

Mobile Surfaces commits to push-to-start tokens (Activity<…>.pushToStartTokenUpdates) without if #available ceremony; deployment target below 17.2 breaks the live-activity adapter at compile time.

**Symptom.** Swift compile errors on pushToStartTokenUpdates references, or a build that succeeds on a lower target only because the symbol was guarded, and then push-to-start silently never works on iOS 16 devices.

**Fix.** Set ios.deploymentTarget to '17.2' in apps/mobile/app.json (or via expo-build-properties) and rerun prebuild.

**See:** `docs/compatibility.md`

### MS013: App Group entitlement must match host app and widget extension

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** app-group, widget, control, config

apps/mobile/app.json and apps/mobile/targets/widget/expo-target.config.js must declare the same com.apple.security.application-groups identifier.

**Symptom.** Widget renders placeholder forever; control widget never reads the toggle state. No error: the entitlement mismatch makes both sides read separate App Group containers.

**Fix.** Set the same group identifier on both sides (default 'group.com.example.mobilesurfaces'; rename via pnpm surface:rename) and rerun prebuild.

**See:** `docs/ios-environment.md`

### MS014: APNs token environment must match the build environment

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, tokens

Tokens minted by a development build cannot authenticate against the production APNs endpoint, and vice versa.

**Symptom.** APNs responds 400 BadDeviceToken. The token is valid; it just belongs to the other environment.

**Fix.** Use environment: 'development' for dev-client and expo run:ios builds, environment: 'production' only for TestFlight and App Store builds. Track which environment minted each token.

**See:** `docs/push.md#error-responses`

### MS016: Subscribe to onPushToStartToken at mount, not on demand

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** tokens, live-activity  •  **ios min:** 17.2

iOS only delivers push-to-start tokens through Activity<…>.pushToStartTokenUpdates as an async sequence; getPushToStartToken() always resolves null.

**Symptom.** Backend never receives a push-to-start token, or only receives one after a manual app re-launch. Remote Live Activity start never fires for users who have not opened the app since install.

**Fix.** Subscribe via liveActivityAdapter.addListener('onPushToStartToken', …) inside a mount-time effect. Re-store the token on every emission, since Apple may rotate at cold launch or system rotation.

**See:** `docs/push.md#token-taxonomy`

### MS017: apps/mobile/ios/ is generated; do not edit

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** cng, config

Continuous Native Generation rebuilds apps/mobile/ios/ from app.json, packages/live-activity/, and apps/mobile/targets/widget/. Manual edits are wiped on the next prebuild.

**Symptom.** An Xcode change you made to fix a build issue disappears after pnpm mobile:prebuild:ios and the original problem returns. Or the change persists locally but breaks every other contributor.

**Fix.** Edit the source files instead: app.json for plist/entitlements, packages/live-activity/ios/ for native module Swift, apps/mobile/targets/widget/ for the WidgetKit target. Then rerun prebuild.

**See:** `docs/ios-environment.md`

### MS018: APNS_BUNDLE_ID must not include the .push-type.liveactivity suffix

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, config

The push SDK auto-appends .push-type.liveactivity to the apns-topic; passing it pre-suffixed produces a malformed topic header.

**Symptom.** APNs responds 400 TopicDisallowed even though your auth key is correctly enabled for the app. The topic header has the suffix doubled or in the wrong position.

**Fix.** Set APNS_BUNDLE_ID to the bare bundle id (e.g. com.example.mobilesurfaces). The SDK and scripts/send-apns.mjs both handle the suffix internally.

**See:** `docs/push.md#error-responses`

### MS020: Per-activity and push-to-start tokens may rotate at any time

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** tokens

Both pushTokenUpdates and pushToStartTokenUpdates may emit fresh values at any moment (cold launch, system rotation, foreground transition).

**Symptom.** Backend send to a stored token returns 410 Unregistered or 400 BadDeviceToken on a previously-working device. The user did nothing wrong; the OS rotated the token.

**Fix.** Treat the latest event as authoritative. Re-store on every emission keyed by user/device id, and update the active record rather than appending.

**See:** `docs/push.md#token-taxonomy`

### MS022: ActivityKit content-state JSON keys must match Swift ContentState

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, swift, contract  •  **enforced by:** `scripts/check-activity-attributes.mjs`

Custom content-state files used with --state-file (or hand-rolled push payloads) must use the same key names and types as MobileSurfacesActivityAttributes.ContentState.

**Symptom.** APNs returns 200, but the Lock Screen stays on the prior content state. The Codable decoder silently fails on a key mismatch and ActivityKit drops the update.

**Fix.** Project through toLiveActivityContentState rather than hand-rolling JSON. If you must hand-roll, mirror the Swift struct verbatim: { headline, subhead, progress, stage }.

### MS024: Project must depend on @mobile-surfaces/surface-contracts (and push, when sending)

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** contract, push

Foreign Expo projects auditing as Mobile Surfaces consumers must list the contract package; backends sending pushes must additionally list @mobile-surfaces/push.

**Symptom.** Type errors on snapshot helpers, or hand-rolled APNs code that diverges from the validated contract. The failure mode is wire-level drift between client and server.

**Fix.** Add @mobile-surfaces/surface-contracts on every layer that emits or consumes a snapshot. Add @mobile-surfaces/push on the backend. Both packages release together (linked group).

**See:** `docs/backend-integration.md`

### MS025: App Group declared in app.json

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** app-group, config

app.json must declare a com.apple.security.application-groups entry for widgets and controls to share state with the host app.

**Symptom.** Widget extension reads its placeholder snapshot, never the live one. Control toggle does nothing visible. No log message; the App Group is just absent.

**Fix.** Add the entitlement to apps/mobile/app.json under expo.ios.entitlements. Match it on the widget target's expo-target.config.js.

**See:** `docs/ios-environment.md`

### MS026: Widget target managed by @bacons/apple-targets

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** widget, control, toolchain

The Mobile Surfaces widget target lives outside the generated ios/ directory and is materialized by @bacons/apple-targets at prebuild time.

**Symptom.** Hand-managed Xcode target gets wiped on the next prebuild, or the widget extension never appears in the built app.

**Fix.** Keep the target source under apps/mobile/targets/widget/ with an expo-target.config.js. Pin @bacons/apple-targets at the supported exact version.

**See:** `docs/architecture.md`

### MS027: Foreign Expo project must target iOS 17.2 or higher

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** ios-version, config  •  **ios min:** 17.2

Same constraint as MS012, applied during an audit of an arbitrary Expo project that adopts Mobile Surfaces.

**Symptom.** Audit fails with a deployment-target mismatch; a downstream prebuild surfaces compile errors on iOS 17.2-only symbols.

**Fix.** Set ios.deploymentTarget to '17.2' (or higher) in app.json or via expo-build-properties.

**See:** `docs/compatibility.md`

### MS028: APNs auth key environment variables must be set before sending

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, tokens

Both the SDK and scripts/send-apns.mjs require APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH, and APNS_BUNDLE_ID.

**Symptom.** Throw at construction time (createPushClient) or at the first send. Often hidden inside a deployment whose env vars never made it into the runtime.

**Fix.** Verify each env var on startup. The SDK's createPushClient validates presence; reject fast if any are missing.

**See:** `docs/push.md#sdk-reference`

### MS029: Generated apps/mobile/ios/ is gitignored

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** cng, config

CNG-managed directories must not be checked into version control; commits will fight prebuild forever.

**Symptom.** Pull request diffs include hundreds of lines under apps/mobile/ios/ that nobody intended to change. Reviewers cannot tell what is real.

**Fix.** Add apps/mobile/ios/ to .gitignore. If files are already tracked, untrack with git rm -r --cached apps/mobile/ios then commit the .gitignore update.

**See:** `docs/ios-environment.md`

### MS010: Toolchain preflight (Node 24, pnpm, Xcode 26+)

**severity:** warning  •  **detection:** config (declarative file)  •  **tags:** toolchain  •  **enforced by:** `scripts/doctor.sh`

pnpm dev:doctor verifies Node 24, pnpm 10, Xcode major 26+, and simulator availability before iOS work begins.

**Symptom.** Builds fail with confusing Swift compiler errors, simulator launches that hang, or pnpm refusing to install. None of which point at the actual cause (a stale toolchain row).

**Fix.** Run pnpm dev:doctor. Update Xcode and re-run if the major version is below 26. Use Node 24.

### MS015: Push priority 5 vs 10 budget rules

**severity:** warning  •  **detection:** runtime (only at send/receive)  •  **tags:** push, live-activity

Live Activity priority 10 is for immediate user-visible updates and is heavily budgeted by iOS; sustained priority 10 sends are silently throttled.

**Symptom.** Updates land for the first few pushes then mysteriously stop arriving on the device. APNs returns 200; iOS still drops them. Logs show TooManyRequests bursts.

**Fix.** Default to priority 5 for Live Activity content-state updates. Reserve priority 10 for state transitions the user must see immediately (queued→active, completed).

**See:** `docs/push.md#error-responses`

### MS021: Discard per-activity tokens when the activity ends

**severity:** warning  •  **detection:** runtime (only at send/receive)  •  **tags:** tokens, live-activity

Once onActivityStateChange reports 'ended' or 'dismissed', the per-activity push token is dead; sending to it is accepted by APNs (200) but iOS will not surface anything.

**Symptom.** Backend keeps spending sends on a token that produces no user-visible effect. No error, just silent drops.

**Fix.** Wire onActivityStateChange to your token store; mark tokens for the activity as terminal and stop selecting them for sends.

**See:** `docs/push.md#token-taxonomy`

### MS023: Per-activity tokens are bound to a single Activity instance

**severity:** warning  •  **detection:** runtime (only at send/receive)  •  **tags:** tokens

A new Activity.request mints a fresh per-activity token; tokens from a previous run cannot drive the new activity.

**Symptom.** Update lands at APNs (200) but appears not to do anything. Reading the harness shows a different per-activity token than what your backend stored.

**Fix.** Re-store on every onPushToken emission; treat tokens as activity-scoped, not user-scoped.

**See:** `docs/push.md#token-taxonomy`

### MS019: FB21158660: push-to-start tokens silent after force-quit

**severity:** info  •  **detection:** advisory (no programmatic check)  •  **tags:** tokens, live-activity  •  **ios min:** 17.2

Apple-reported bug. After the user force-quits the app, pushToStartTokenUpdates may stop emitting until the next OS push wakes the app, but the previously-issued token still authenticates against APNs (200 response, no actual activity start).

**Symptom.** Backend successfully sends a remote start, gets 200, but the Lock Screen never shows the activity. User has force-quit the app since the last token rotation.

**Fix.** No client workaround. Document in customer-support runbooks: 'If the Lock Screen activity does not appear after a remote-start push, ask the user to open the app once.'

**See:** `docs/push.md#fb21158660-push-to-start-after-force-quit`

## Related local documentation

- [`docs/architecture.md`](docs/architecture.md): the contract, the surfaces, the adapter boundary.
- [`docs/multi-surface.md`](docs/multi-surface.md): every `kind` value and the projection it drives.
- [`docs/backend-integration.md`](docs/backend-integration.md): domain event to snapshot to APNs walkthrough.
- [`docs/push.md`](docs/push.md): wire-layer reference, SDK, smoke script, token taxonomy, error reasons.
- [`docs/troubleshooting.md`](docs/troubleshooting.md): symptom-to-fix recipes for failures not in this catalog.
- [`docs/traps.md`](docs/traps.md): schema and workflow for editing this catalog.

