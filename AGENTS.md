<!--
  THIS FILE IS GENERATED. DO NOT EDIT.
  Source: data/traps.json (validated by packages/surface-contracts/src/traps.ts).
  Regenerate with: node --experimental-strip-types scripts/build-agents-md.mjs
  CI fails on drift via: pnpm surface:check
-->

# Mobile Surfaces: Invariants for AI Coding Assistants

This document lists the mandatory invariants enforced by Mobile Surfaces' test suite. AI coding assistants working in a Mobile Surfaces project must respect these rules; `pnpm surface:check` enforces them in CI. The same rules apply to human engineers; the catalog makes them explicit. It is generated from `data/traps.json` — edits go to the catalog, not to this file.

Mobile Surfaces is an Expo iOS reference architecture for Live Activities, Dynamic Island, home-screen widgets, and iOS 18 control widgets. iOS Live Activities silently fail: your code compiles, your push returns 200, and nothing appears on the Lock Screen. This catalog enumerates the failure modes that produce that silence and the static, config, and runtime checks the repo uses to surface them at PR time instead of on a customer device.

## Index

37 rules total: 29 error, 4 warning, 4 info.

| ID | Severity | Detection | Title |
| --- | --- | --- | --- |
| [MS001](#ms001-live-activity-adapter-boundary) | error | static | Live Activity adapter boundary |
| [MS002](#ms002-activitykit-attribute-file-byte-identity) | error | static | ActivityKit attribute file byte-identity |
| [MS003](#ms003-swift-contentstate-fields-and-json-keys-match-zod-livesurfaceactivitycontentstate) | error | static | Swift ContentState fields and JSON keys match Zod liveSurfaceActivityContentState |
| [MS004](#ms004-swift-stage-enum-cases-match-zod-livesurfacestage) | error | static | Swift Stage enum cases match Zod liveSurfaceStage |
| [MS006](#ms006-generated-json-schema-must-match-zod-source) | error | static | Generated JSON Schema must match Zod source |
| [MS007](#ms007-all-committed-fixtures-must-parse-as-livesurfacesnapshot) | error | static | All committed fixtures must parse as LiveSurfaceSnapshot |
| [MS008](#ms008-snapshot-kind-must-match-its-projection-slice) | error | static | Snapshot kind must match its projection slice |
| [MS009](#ms009-generated-typescript-fixtures-must-match-json-sources) | error | static | Generated TypeScript fixtures must match JSON sources |
| [MS011](#ms011-activitykit-payload-size-ceiling-4-kb-5-kb-broadcast) | error | runtime | ActivityKit payload size ceiling (4 KB / 5 KB broadcast) |
| [MS012](#ms012-ios-deployment-target-must-be-17-2-or-higher) | error | config | iOS deployment target must be 17.2 or higher |
| [MS013](#ms013-app-group-entitlement-must-match-host-app-and-widget-extension) | error | static | App Group entitlement must match host app and widget extension |
| [MS014](#ms014-apns-token-environment-must-match-the-build-environment) | error | runtime | APNs token environment must match the build environment |
| [MS016](#ms016-subscribe-to-onpushtostarttoken-at-mount-not-on-demand) | error | runtime | Subscribe to onPushToStartToken at mount, not on demand |
| [MS017](#ms017-apps-mobile-ios-is-generated-do-not-edit) | error | advisory | apps/mobile/ios/ is generated; do not edit |
| [MS018](#ms018-apns-bundle-id-must-not-include-the-push-type-liveactivity-suffix) | error | runtime | APNS_BUNDLE_ID must not include the .push-type.liveactivity suffix |
| [MS020](#ms020-per-activity-and-push-to-start-tokens-may-rotate-at-any-time) | error | runtime | Per-activity and push-to-start tokens may rotate at any time |
| [MS024](#ms024-project-must-depend-on-mobile-surfaces-surface-contracts-and-push-when-sending) | error | config | Project must depend on @mobile-surfaces/surface-contracts (and push, when sending) |
| [MS025](#ms025-app-group-declared-in-app-json) | error | config | App Group declared in app.json |
| [MS026](#ms026-widget-target-managed-by-bacons-apple-targets) | error | config | Widget target managed by @bacons/apple-targets |
| [MS027](#ms027-foreign-expo-project-must-target-ios-17-2-or-higher) | error | config | Foreign Expo project must target iOS 17.2 or higher |
| [MS028](#ms028-apns-auth-key-environment-variables-must-be-set-before-sending) | error | runtime | APNs auth key environment variables must be set before sending |
| [MS029](#ms029-generated-apps-mobile-ios-is-gitignored) | error | config | Generated apps/mobile/ios/ is gitignored |
| [MS030](#ms030-apns-provider-token-must-be-valid-and-current) | error | runtime | APNs provider token must be valid and current |
| [MS031](#ms031-channel-management-failures-missing-malformed-or-unregistered-channel-id) | error | runtime | Channel management failures (missing, malformed, or unregistered channel id) |
| [MS032](#ms032-activity-timestamp-fields-must-be-valid-unix-seconds-integers) | error | runtime | Activity timestamp fields must be valid unix-seconds integers |
| [MS034](#ms034-broadcast-capability-must-be-enabled-on-the-apns-auth-key) | error | runtime | Broadcast capability must be enabled on the APNs auth key |
| [MS035](#ms035-apns-topic-header-missing-or-bundleid-misconfigured) | error | runtime | apns-topic header missing or bundleId misconfigured |
| [MS036](#ms036-surface-snapshot-swift-structs-match-their-zod-projection-output-schemas) | error | static | Surface snapshot Swift structs match their Zod projection-output schemas |
| [MS037](#ms037-notification-category-outputs-in-sync-with-canonical-registry) | error | static | Notification category outputs in sync with canonical registry |
| [MS010](#ms010-toolchain-preflight-node-24-pnpm-xcode-26) | warning | config | Toolchain preflight (Node 24, pnpm, Xcode 26+) |
| [MS015](#ms015-push-priority-5-vs-10-budget-rules) | warning | runtime | Push priority 5 vs 10 budget rules |
| [MS021](#ms021-discard-per-activity-tokens-when-the-activity-ends) | warning | runtime | Discard per-activity tokens when the activity ends |
| [MS023](#ms023-per-activity-tokens-are-bound-to-a-single-activity-instance) | warning | runtime | Per-activity tokens are bound to a single Activity instance |
| [MS005](#ms005-retired-rule-id-reserved) | info | advisory | Retired rule (id reserved) |
| [MS019](#ms019-fb21158660-push-to-start-tokens-silent-after-force-quit) | info | advisory | FB21158660: push-to-start tokens silent after force-quit |
| [MS022](#ms022-retired-rule-merged-into-ms003) | info | advisory | Retired rule (merged into MS003) |
| [MS033](#ms033-retired-rule-id-reserved) | info | advisory | Retired rule (id reserved) |

## Rules by tag

- `app-group`: MS013, MS025
- `channels`: MS031, MS034
- `cng`: MS017, MS029
- `config`: MS012, MS013, MS017, MS018, MS025, MS027, MS029, MS034, MS035, MS037
- `contract`: MS001, MS003, MS004, MS005, MS006, MS007, MS008, MS009, MS022, MS024, MS033, MS036, MS037
- `control`: MS013, MS026, MS036
- `ios-version`: MS012, MS027
- `ios18`: MS031, MS034
- `live-activity`: MS001, MS002, MS003, MS004, MS011, MS015, MS016, MS019, MS021, MS032
- `notification`: MS037
- `push`: MS006, MS011, MS014, MS015, MS018, MS024, MS028, MS030, MS031, MS032, MS034, MS035
- `swift`: MS002, MS003, MS004, MS036
- `tokens`: MS014, MS016, MS019, MS020, MS021, MS023, MS028, MS030
- `toolchain`: MS010, MS026
- `widget`: MS013, MS026, MS036

## How to use this document

- **When generating or editing code in a Mobile Surfaces project**, treat every `error` rule as a hard invariant. Do not bypass it; if your change requires breaking the invariant, surface that to the user and stop.
- **When auditing an existing project**, walk the index from top to bottom. Static rules can be checked by reading files; config rules by reading `app.json`, `package.json`, and `expo-target.config.js`; runtime rules by inspecting recent APNs response codes; advisory rules by reading the symptom and confirming the user has runbook coverage.
- **When suggesting fixes**, cite the rule id (e.g. `MS013`) so the user can trace the recommendation. The catalog id is stable across releases.
- **Source of truth.** This file is generated from `data/traps.json`. The long-form docs live on the live site at https://mobile-surfaces.com/docs; this catalog carries the action-oriented summary.

## Rules

### MS001: Live Activity adapter boundary

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, contract  •  **enforced by:** `scripts/check-adapter-boundary.mjs`

Application code under apps/*/src/ must import the live-activity adapter through the boundary re-export, never directly from @mobile-surfaces/live-activity.

**Symptom.** Compile-time imports look fine, but call sites bypass the centralized re-export typed against LiveActivityAdapter. A future swap to expo-live-activity, expo-widgets, or a custom native module then has to update every importer instead of one shim, and the tsc-enforced adapter surface stops catching drift.

**Fix.** Import from apps/mobile/src/liveActivity (the boundary re-export) instead of @mobile-surfaces/live-activity directly. Add new methods to the adapter contract first, not at the call site.

**See:** [https://mobile-surfaces.com/docs/architecture#adapter-contract](https://mobile-surfaces.com/docs/architecture#adapter-contract)

### MS002: ActivityKit attribute file byte-identity

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, swift  •  **enforced by:** `scripts/check-activity-attributes.mjs`

MobileSurfacesActivityAttributes.swift in packages/live-activity/ios/ and apps/mobile/targets/widget/ must be byte-identical, and both must match the codegen output from packages/surface-contracts/src/schema.ts.

**Symptom.** Activity starts on the device but never appears on the Lock Screen. No log, no error. ActivityKit silently drops updates whose decoded ContentState shape does not match the widget extension's struct.

**Fix.** Both files are generated from the Zod source of truth. Edit liveSurfaceActivityContentState or liveSurfaceStage in packages/surface-contracts/src/schema.ts, then run pnpm surface:codegen to regenerate both files. CI gates codegen drift at stage 2 and byte-identity + Zod parity at stage 3. The follow-up plan to consolidate this duplication into a local Swift Package is upstream-blocked on @bacons/apple-targets local-SPM support and RN 0.84 local-path spm_dependency landing in Expo SDK 56; codegen is the intermediate state until that unblocks.

**See:** [https://mobile-surfaces.com/docs/architecture#native-constraints](https://mobile-surfaces.com/docs/architecture#native-constraints)

### MS003: Swift ContentState fields and JSON keys match Zod liveSurfaceActivityContentState

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, swift, contract  •  **enforced by:** `scripts/check-activity-attributes.mjs`

MobileSurfacesActivityAttributes.ContentState must declare the same fields, types, and JSON keys as liveSurfaceActivityContentState in packages/surface-contracts/src/schema.ts. Both Swift attribute files participate; the JSON-key shape is what ActivityKit decodes from the push payload.

**Symptom.** Push lands at APNs (200) but the Lock Screen view stays on its old state. The Codable decoder silently fails on a renamed key or a type mismatch and ActivityKit drops the update without surfacing an error.

**Fix.** Update the Zod source first, regenerate the JSON Schema (pnpm surface:check), then mirror the field change into both Swift attribute files. Project payloads through toLiveActivityContentState rather than hand-rolling JSON so the JS layer cannot diverge from the contract.

### MS004: Swift Stage enum cases match Zod liveSurfaceStage

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** live-activity, swift, contract  •  **enforced by:** `scripts/check-activity-attributes.mjs`

The Stage enum in MobileSurfacesActivityAttributes.swift must cover exactly the cases listed in liveSurfaceStage.

**Symptom.** ContentState decodes but the stage value falls back to a default. Your Lock Screen never shows 'completing' even after the job is done.

**Fix.** Add or remove cases in lockstep: Zod first, regenerate the schema, mirror into both Swift files.

### MS006: Generated JSON Schema must match Zod source

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** contract, push  •  **enforced by:** `scripts/build-schema.mjs`

packages/surface-contracts/schema.json must be regenerated whenever the Zod source changes; CI fails if the committed file is stale.

**Symptom.** Backends validating with Ajv or jsonschema accept payloads the runtime then rejects (or vice versa). Consumers pinning the unpkg URL get out-of-date validation.

**Fix.** Run node --experimental-strip-types scripts/build-schema.mjs and commit the result.

### MS007: All committed fixtures must parse as LiveSurfaceSnapshot

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** contract  •  **enforced by:** `scripts/validate-surface-fixtures.mjs`

Every JSON file under data/surface-fixtures/ must parse via the v3 discriminated union (after $schema is stripped).

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

Per-activity Live Activity pushes are bounded at 4 KB; iOS 18 broadcast pushes at 5 KB. Standard notification alert pushes (push-type alert, kind notification) share the 4 KB ceiling; the 5 KB allowance is ActivityKit-broadcast-only and does not apply to sendNotification.

**Symptom.** APNs returns 413 PayloadTooLarge, or accepts the payload but iOS silently drops the update. Long localized strings or accumulated morePartsCount details are common offenders.

**Fix.** Trim the payload. Per-activity payloads are bounded at 4 KB; broadcast payloads at 5 KB. Shorten the liveActivity slice's body, lower morePartsCount, or split a state into two smaller pushes. Validate by sending the projection through toLiveActivityContentState and measuring.

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

**Apple docs:** [ref 1](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)

### MS012: iOS deployment target must be 17.2 or higher

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** ios-version, config  •  **ios min:** 17.2  •  **enforced by:** `scripts/probe-app-config.mjs`

Mobile Surfaces commits to push-to-start tokens (Activity<...>.pushToStartTokenUpdates) without if #available ceremony; deployment target below 17.2 breaks the live-activity adapter at compile time.

**Symptom.** Swift compile errors on pushToStartTokenUpdates references, or a build that succeeds on a lower target only because the symbol was guarded, and then push-to-start silently never works on iOS 16 devices.

**Fix.** Set ios.deploymentTarget to '17.2' in apps/mobile/app.json (or via expo-build-properties) and rerun prebuild.

**See:** [https://mobile-surfaces.com/docs/compatibility](https://mobile-surfaces.com/docs/compatibility)

### MS013: App Group entitlement must match host app and widget extension

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** app-group, widget, control, config  •  **enforced by:** `scripts/check-app-group-identity.mjs`

apps/mobile/app.json is the single source of truth for the App Group identifier. The widget entitlements file at apps/mobile/targets/widget/generated.entitlements, the Swift constant at apps/mobile/targets/_shared/MobileSurfacesAppGroup.swift, and the TS constant at apps/mobile/src/generated/appGroup.ts are codegened from it and must not be hand-edited. check-app-group-identity is the defense-in-depth identity check across the four declaration sites; the primary enforcer is the generate-app-group-constants --check gate at stage 2.

**Symptom.** Widget renders placeholder forever; control widget never reads the toggle state. No error: the entitlement mismatch makes both sides read separate App Group containers.

**Fix.** Edit app.json and run pnpm surface:codegen to regenerate the Swift constant, TS constant, and widget entitlements in lockstep. Rename across every site via pnpm surface:rename. Hand edits to the generated files revert on the next codegen and fail the stage-2 drift gate.

**See:** [https://mobile-surfaces.com/docs/ios-environment](https://mobile-surfaces.com/docs/ios-environment)

### MS014: APNs token environment must match the build environment

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, tokens

Tokens minted by a development build cannot authenticate against the production APNs endpoint, and vice versa.

**Symptom.** APNs responds 400 BadDeviceToken. The token is valid; it just belongs to the other environment.

**Fix.** Use environment: 'development' for dev-client and expo run:ios builds, environment: 'production' only for TestFlight and App Store builds. Track which environment minted each token.

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

### MS016: Subscribe to onPushToStartToken at mount, not on demand

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** tokens, live-activity  •  **ios min:** 17.2

iOS only delivers push-to-start tokens through Activity<...>.pushToStartTokenUpdates as an async sequence; getPushToStartToken() always resolves null.

**Symptom.** Backend never receives a push-to-start token, or only receives one after a manual app re-launch. Remote Live Activity start never fires for users who have not opened the app since install.

**Fix.** Subscribe via liveActivityAdapter.addListener('onPushToStartToken', ...) inside a mount-time effect. Re-store the token on every emission, since Apple may rotate at cold launch or system rotation.

**See:** [https://mobile-surfaces.com/docs/push#token-taxonomy](https://mobile-surfaces.com/docs/push#token-taxonomy)

### MS017: apps/mobile/ios/ is generated; do not edit

**severity:** error  •  **detection:** advisory (no programmatic check)  •  **tags:** cng, config

Continuous Native Generation rebuilds apps/mobile/ios/ from app.json, packages/live-activity/, and apps/mobile/targets/widget/. Manual edits are wiped on the next prebuild.

**Symptom.** An Xcode change you made to fix a build issue disappears after pnpm mobile:prebuild:ios and the original problem returns. Or the change persists locally but breaks every other contributor.

**Fix.** Edit the source files instead: app.json for plist/entitlements, packages/live-activity/ios/ for native module Swift, apps/mobile/targets/widget/ for the WidgetKit target. Then rerun prebuild.

**See:** [https://mobile-surfaces.com/docs/ios-environment](https://mobile-surfaces.com/docs/ios-environment)

### MS018: APNS_BUNDLE_ID must not include the .push-type.liveactivity suffix

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, config

The push SDK auto-appends .push-type.liveactivity to the apns-topic; passing it pre-suffixed produces a malformed topic header.

**Symptom.** APNs responds 400 TopicDisallowed even though your auth key is correctly enabled for the app. The topic header has the suffix doubled or in the wrong position.

**Fix.** Set APNS_BUNDLE_ID to the bare bundle id (e.g. com.example.mobilesurfaces). The SDK and scripts/send-apns.mjs both handle the suffix internally.

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

### MS020: Per-activity and push-to-start tokens may rotate at any time

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** tokens

Both pushTokenUpdates and pushToStartTokenUpdates may emit fresh values at any moment (cold launch, system rotation, foreground transition).

**Symptom.** Backend send to a stored token returns 410 Unregistered or 400 BadDeviceToken on a previously-working device. The user did nothing wrong; the OS rotated the token.

**Fix.** Treat the latest event as authoritative. Re-store on every emission keyed by user/device id, and update the active record rather than appending.

**See:** [https://mobile-surfaces.com/docs/push#token-taxonomy](https://mobile-surfaces.com/docs/push#token-taxonomy)

### MS024: Project must depend on @mobile-surfaces/surface-contracts (and push, when sending)

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** contract, push  •  **enforced by:** `scripts/probe-app-config.mjs`

Foreign Expo projects auditing as Mobile Surfaces consumers must list the contract package; backends sending pushes must additionally list @mobile-surfaces/push.

**Symptom.** Type errors on snapshot helpers, or hand-rolled APNs code that diverges from the validated contract. The failure mode is wire-level drift between client and server.

**Fix.** Add @mobile-surfaces/surface-contracts on every layer that emits or consumes a snapshot. Add @mobile-surfaces/push on the backend. Both packages release together (linked group).

**See:** [https://mobile-surfaces.com/docs/backend-integration](https://mobile-surfaces.com/docs/backend-integration)

### MS025: App Group declared in app.json

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** app-group, config  •  **enforced by:** `scripts/probe-app-config.mjs`

app.json must declare a com.apple.security.application-groups entry for widgets and controls to share state with the host app.

**Symptom.** Widget extension reads its placeholder snapshot, never the live one. Control toggle does nothing visible. No log message; the App Group is just absent.

**Fix.** Add the entitlement to apps/mobile/app.json under expo.ios.entitlements. Match it on the widget target's expo-target.config.js.

**See:** [https://mobile-surfaces.com/docs/ios-environment](https://mobile-surfaces.com/docs/ios-environment)

### MS026: Widget target managed by @bacons/apple-targets

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** widget, control, toolchain

The Mobile Surfaces widget target lives outside the generated ios/ directory and is materialized by @bacons/apple-targets at prebuild time.

**Symptom.** Hand-managed Xcode target gets wiped on the next prebuild, or the widget extension never appears in the built app.

**Fix.** Keep the target source under apps/mobile/targets/widget/ with an expo-target.config.js. Pin @bacons/apple-targets at the supported exact version.

**See:** [https://mobile-surfaces.com/docs/architecture](https://mobile-surfaces.com/docs/architecture)

### MS027: Foreign Expo project must target iOS 17.2 or higher

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** ios-version, config  •  **ios min:** 17.2  •  **enforced by:** `scripts/probe-app-config.mjs`

Same constraint as MS012, applied during an audit of an arbitrary Expo project that adopts Mobile Surfaces.

**Symptom.** Audit fails with a deployment-target mismatch; a downstream prebuild surfaces compile errors on iOS 17.2-only symbols.

**Fix.** Set ios.deploymentTarget to '17.2' (or higher) in app.json or via expo-build-properties.

**See:** [https://mobile-surfaces.com/docs/compatibility](https://mobile-surfaces.com/docs/compatibility)

### MS028: APNs auth key environment variables must be set before sending

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, tokens

Both the SDK and scripts/send-apns.mjs require APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH, and APNS_BUNDLE_ID.

**Symptom.** Throw at construction time (createPushClient) or at the first send. Often hidden inside a deployment whose env vars never made it into the runtime.

**Fix.** Verify each env var on startup. The SDK's createPushClient validates presence; reject fast if any are missing.

**See:** [https://mobile-surfaces.com/docs/push#sdk-reference](https://mobile-surfaces.com/docs/push#sdk-reference)

### MS029: Generated apps/mobile/ios/ is gitignored

**severity:** error  •  **detection:** config (declarative file)  •  **tags:** cng, config  •  **enforced by:** `scripts/check-ios-gitignore.mjs`

CNG-managed directories must not be checked into version control; commits will fight prebuild forever.

**Symptom.** Pull request diffs include hundreds of lines under apps/mobile/ios/ that nobody intended to change. Reviewers cannot tell what is real.

**Fix.** Add apps/mobile/ios/ to .gitignore. If files are already tracked, untrack with git rm -r --cached apps/mobile/ios then commit the .gitignore update.

**See:** [https://mobile-surfaces.com/docs/ios-environment](https://mobile-surfaces.com/docs/ios-environment)

### MS030: APNs provider token must be valid and current

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, tokens

APNs returns 403 with reason Forbidden, InvalidProviderToken, or ExpiredProviderToken when the auth-key JWT cannot be verified; each reason has a distinct operator response.

**Symptom.** All sends fail with 403. ForbiddenError means the auth key was revoked in the Apple Developer portal. InvalidProviderTokenError means the JWT is malformed or signed with the wrong key id / team id. ExpiredProviderTokenError means the JWT is older than 60 minutes (typically clock skew, since the SDK refreshes at 50 minutes).

**Fix.** ForbiddenError: mint a new auth key in the Apple Developer portal and update APNS_KEY_ID / APNS_KEY_PATH. InvalidProviderTokenError: verify APNS_KEY_ID matches the key file and APNS_TEAM_ID matches the developer account. ExpiredProviderTokenError: check system clock alignment against NTP; if the SDK is long-lived, confirm createPushClient is not being held past process restarts without re-minting.

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

### MS031: Channel management failures (missing, malformed, or unregistered channel id)

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, channels, ios18

Broadcast and channel-admin calls reject when the channel id is missing from the request, malformed on the wire, or refers to a channel that was never created in the target environment.

**Symptom.** Broadcast or channel management fails with 400 (missing or bad channel id) or 410 (not registered). Common root causes: the channel was created against the opposite APNs environment, or the id was URL-decoded, truncated, or otherwise mutated before being sent back.

**Fix.** MissingChannelId: pass channelId to broadcast() or deleteChannel(). BadChannelId: use the id returned by createChannel() verbatim with no URL-decoding or truncation. ChannelNotRegistered: channels are environment-scoped, so re-create the channel in the target environment or call listChannels() to confirm the id exists there.

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

### MS032: Activity timestamp fields must be valid unix-seconds integers

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, live-activity

APNs rejects Live Activity pushes whose date fields (staleDateSeconds, dismissalDateSeconds, apns-expiration) are not positive unix-seconds integers, and rejects broadcast sends to a no-storage channel that carry a nonzero apns-expiration.

**Symptom.** APNs returns 400 BadDate or 400 BadExpirationDate. The push payload looked valid locally but a date field was a millisecond timestamp, a negative number, or a non-integer; or apns-expiration was set on a no-storage broadcast channel.

**Fix.** Confirm every date field is a positive unix-seconds integer (not milliseconds, not Date.now()). For broadcast on a no-storage channel, apns-expiration must be 0; the SDK's broadcast() already enforces this.

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

### MS034: Broadcast capability must be enabled on the APNs auth key

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, channels, ios18, config

iOS 18 broadcast pushes and channel-admin calls require the 'Broadcast to Live Activity' capability on the APNs auth key. The capability is per-key, not per-app, and is invisible until the first send fails.

**Symptom.** createChannel() or broadcast() fails with 403 FeatureNotEnabled. The auth key is otherwise valid and other push types succeed; only broadcast-related calls reject.

**Fix.** Enable broadcast in the Apple Developer portal under Certificates, Identifiers & Profiles > Keys > select the key > edit > tick 'Broadcast to Live Activity'. Save and retry; no client change is needed.

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

### MS035: apns-topic header missing or bundleId misconfigured

**severity:** error  •  **detection:** runtime (only at send/receive)  •  **tags:** push, config

APNs requires an apns-topic header on every request; the SDK derives it from APNS_BUNDLE_ID and a missing or empty bundle id produces a malformed topic at send time.

**Symptom.** APNs returns 400 MissingTopic. The bundle id was unset or an empty string, so the SDK emitted only the .push-type.liveactivity suffix (or nothing) as the topic header.

**Fix.** Confirm APNS_BUNDLE_ID is set to the bare bundle identifier (e.g. com.example.app). Do not include the .push-type.liveactivity suffix; the SDK appends it internally. See MS018 for the inverse failure (suffix included by mistake).

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

### MS036: Surface snapshot Swift structs match their Zod projection-output schemas

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** widget, control, swift, contract  •  **enforced by:** `scripts/check-surface-snapshots.mjs`

Every hand-maintained Codable struct in apps/mobile/targets/_shared/MobileSurfacesSharedState.swift that decodes a Zod projection-output schema (today: MobileSurfacesWidgetSnapshot, MobileSurfacesControlSnapshot, MobileSurfacesLockAccessorySnapshot, MobileSurfacesStandbySnapshot, mapping to liveSurfaceWidgetTimelineEntry, liveSurfaceControlValueProvider, liveSurfaceLockAccessoryEntry, liveSurfaceStandbyEntry in packages/surface-contracts/src/schema.ts) must declare the same fields, types, JSON keys, and optionality as its schema. New surfaces register their struct + schema pair in scripts/check-surface-snapshots.mjs's SURFACES list. This extends the MS003 guarantee from the Lock Screen to every non-Live-Activity surface.

**Symptom.** The widget, control, lock-accessory, or StandBy surface renders placeholder data forever. The host writes a snapshot into the App Group container, but JSONDecoder in the widget extension silently fails on a renamed key, a type mismatch, or an optionality mismatch and returns nil. No log, no error.

**Fix.** Update the Zod projection-output schema first (and the projection helper that feeds it), then mirror the field, type, JSON key, and optionality change into the matching struct in MobileSurfacesSharedState.swift. Run pnpm surface:check; check-surface-snapshots.mjs verifies all four structs against their schemas.

### MS037: Notification category outputs in sync with canonical registry

**severity:** error  •  **detection:** static (script-checkable)  •  **tags:** notification, contract, config  •  **enforced by:** `scripts/generate-notification-categories.mjs`

packages/surface-contracts/src/notificationCategories.ts is the single source of truth for every UNNotificationCategory identifier Mobile Surfaces ships. The generated TS constant at apps/mobile/src/generated/notificationCategories.ts (host registration), the Swift constant at apps/mobile/targets/_shared/MobileSurfacesNotificationCategories.swift (extension routing), and (when the file exists) the UNNotificationExtensionCategory array in apps/mobile/targets/notification-content/Info.plist are all codegened from it and must not be hand-edited. The schema enforces parity at the wire boundary by constraining liveSurfaceNotificationSlice.category to z.enum over the registry's ids.

**Symptom.** Notification arrives at the device with aps.category set, but the UNNotificationContentExtension is never invoked: the user sees the default system chrome instead of the surface-aware custom view. No log, no error - iOS silently falls back when the payload category does not match any registered UNNotificationExtensionCategory in the extension Info.plist.

**Fix.** Edit packages/surface-contracts/src/notificationCategories.ts and run pnpm surface:codegen to regenerate every consumer in lockstep. The schema-level z.enum constraint rejects payloads that name a category outside the registry, so the wire stays load-bearing for parity.

### MS010: Toolchain preflight (Node 24, pnpm, Xcode 26+)

**severity:** warning  •  **detection:** config (declarative file)  •  **tags:** toolchain  •  **enforced by:** `scripts/doctor.mjs`

pnpm dev:doctor verifies Node 24, pnpm 10, Xcode major 26+, and simulator availability before iOS work begins.

**Symptom.** Builds fail with confusing Swift compiler errors, simulator launches that hang, or pnpm refusing to install. None of which point at the actual cause (a stale toolchain row).

**Fix.** Run pnpm dev:doctor. Update Xcode and re-run if the major version is below 26. Use Node 24.

### MS015: Push priority 5 vs 10 budget rules

**severity:** warning  •  **detection:** runtime (only at send/receive)  •  **tags:** push, live-activity

Live Activity priority 10 is for immediate user-visible updates and is heavily budgeted by iOS; sustained priority 10 sends are silently throttled.

**Symptom.** Updates land for the first few pushes then mysteriously stop arriving on the device. APNs returns 200; iOS still drops them. Logs show TooManyRequests bursts.

**Fix.** Default to priority 5 for Live Activity content-state updates. Reserve priority 10 for state transitions the user must see immediately (queued→active, completed).

**See:** [https://mobile-surfaces.com/docs/push#error-responses](https://mobile-surfaces.com/docs/push#error-responses)

### MS021: Discard per-activity tokens when the activity ends

**severity:** warning  •  **detection:** runtime (only at send/receive)  •  **tags:** tokens, live-activity

Once onActivityStateChange reports 'ended' or 'dismissed', the per-activity push token is dead; sending to it is accepted by APNs (200) but iOS will not surface anything.

**Symptom.** Backend keeps spending sends on a token that produces no user-visible effect. No error, just silent drops.

**Fix.** Wire onActivityStateChange to your token store; mark tokens for the activity as terminal and stop selecting them for sends.

**See:** [https://mobile-surfaces.com/docs/push#token-taxonomy](https://mobile-surfaces.com/docs/push#token-taxonomy)

### MS023: Per-activity tokens are bound to a single Activity instance

**severity:** warning  •  **detection:** runtime (only at send/receive)  •  **tags:** tokens

A new Activity.request mints a fresh per-activity token; tokens from a previous run cannot drive the new activity.

**Symptom.** Update lands at APNs (200) but appears not to do anything. Reading the harness shows a different per-activity token than what your backend stored.

**Fix.** Re-store on every onPushToken emission; treat tokens as activity-scoped, not user-scoped.

**See:** [https://mobile-surfaces.com/docs/push#token-taxonomy](https://mobile-surfaces.com/docs/push#token-taxonomy)

### MS005: Retired rule (id reserved)

**severity:** info  •  **detection:** advisory (no programmatic check)  •  **tags:** contract

Reserved id. The original rule was removed before its prose was preserved in git history; the id is held back so external references (PR comments, log lines, blog posts citing MS005) keep resolving to a known marker rather than collide with a future rule.

**Symptom.** n/a (retired).

**Fix.** n/a (retired). Numbering policy: trap ids are monotonic forever; deletions reserve the id with deprecated: true.

### MS019: FB21158660: push-to-start tokens silent after force-quit

**severity:** info  •  **detection:** advisory (no programmatic check)  •  **tags:** tokens, live-activity  •  **ios min:** 17.2

Apple-reported bug. After the user force-quits the app, pushToStartTokenUpdates may stop emitting until the next OS push wakes the app, but the previously-issued token still authenticates against APNs (200 response, no actual activity start).

**Symptom.** Backend successfully sends a remote start, gets 200, but the Lock Screen never shows the activity. User has force-quit the app since the last token rotation.

**Fix.** No client workaround. Document in customer-support runbooks: 'If the Lock Screen activity does not appear after a remote-start push, ask the user to open the app once.'

**See:** [https://mobile-surfaces.com/docs/push#fb21158660-push-to-start-after-force-quit](https://mobile-surfaces.com/docs/push#fb21158660-push-to-start-after-force-quit)

### MS022: Retired rule (merged into MS003)

**severity:** info  •  **detection:** advisory (no programmatic check)  •  **tags:** contract

Reserved id. The original rule was an early-draft duplicate of MS003 (Swift ContentState fields and JSON keys match Zod liveSurfaceActivityContentState) and was merged into it. See git commit d79ffb0.

**Symptom.** See MS003.

**Fix.** See MS003. Numbering policy: trap ids are monotonic forever; deletions reserve the id with deprecated: true.

### MS033: Retired rule (id reserved)

**severity:** info  •  **detection:** advisory (no programmatic check)  •  **tags:** contract

Reserved id. The original rule was removed before its prose was preserved in git history; the id is held back so external references (PR comments, log lines, blog posts citing MS033) keep resolving to a known marker rather than collide with a future rule.

**Symptom.** n/a (retired).

**Fix.** n/a (retired). Numbering policy: trap ids are monotonic forever; deletions reserve the id with deprecated: true.

## Related local documentation

- [Architecture](https://mobile-surfaces.com/docs/architecture): the contract, the surfaces, the adapter boundary.
- [Multi-surface](https://mobile-surfaces.com/docs/multi-surface): every `kind` value and the projection it drives.
- [Backend integration](https://mobile-surfaces.com/docs/backend-integration): domain event to snapshot to APNs walkthrough.
- [Push](https://mobile-surfaces.com/docs/push): wire-layer reference, SDK, smoke script, token taxonomy, error reasons.
- [Observability](https://mobile-surfaces.com/docs/observability): which catalog-bound errors are worth alerting on, what a stuck Live Activity looks like on the wire, recommended log shape.
- [Troubleshooting](https://mobile-surfaces.com/docs/troubleshooting): symptom-to-fix recipes for failures not in this catalog.
- [Trap catalog maintenance](https://mobile-surfaces.com/docs/traps): schema and workflow for editing this catalog.

