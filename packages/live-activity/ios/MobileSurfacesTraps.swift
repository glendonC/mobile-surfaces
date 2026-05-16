// GENERATED - DO NOT EDIT.
// Source: data/traps.json. Regenerate: pnpm surface:codegen.
//
// Byte-identity replicated into three sites (MS040):
//   packages/traps/swift/MobileSurfacesTraps.swift           (canonical)
//   packages/live-activity/ios/MobileSurfacesTraps.swift     (native module pod)
//   apps/mobile/targets/_shared/MobileSurfacesTraps.swift    (widget + notification-content via _shared/)

import Foundation

public protocol MSTrapBound: Error {
  var trapId: String? { get }
  var docsUrl: String? { get }
}

public struct MSTrapBinding: Sendable {
  public let id: String
  public let title: String
  public let severity: String
  public let detection: String
  public let summary: String
  public let symptom: String
  public let fix: String
  public let docsUrl: String
}

public enum MSTraps {
  public static let all: [String: MSTrapBinding] = [
    "MS001": MSTrapBinding(
      id: "MS001",
      title: "Live Activity adapter boundary",
      severity: "error",
      detection: "static",
      summary: "Application code under apps/*/src/ must import the live-activity adapter through the boundary re-export, never directly from @mobile-surfaces/live-activity.",
      symptom: "Compile-time imports look fine, but call sites bypass the centralized re-export typed against LiveActivityAdapter. A future swap to expo-live-activity, expo-widgets, or a custom native module then has to update every importer instead of one shim, and the tsc-enforced adapter surface stops catching drift.",
      fix: "Import from apps/mobile/src/liveActivity (the boundary re-export) instead of @mobile-surfaces/live-activity directly. Add new methods to the adapter contract first, not at the call site.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms001-live-activity-adapter-boundary"
    ),
    "MS002": MSTrapBinding(
      id: "MS002",
      title: "ActivityKit attribute file byte-identity",
      severity: "error",
      detection: "static",
      summary: "MobileSurfacesActivityAttributes.swift in packages/live-activity/ios/ and apps/mobile/targets/widget/ must be byte-identical, and both must match the codegen output from packages/surface-contracts/src/schema.ts.",
      symptom: "Activity starts on the device but never appears on the Lock Screen. No log, no error. ActivityKit silently drops updates whose decoded ContentState shape does not match the widget extension's struct.",
      fix: "Both files are generated from the Zod source of truth. Edit liveSurfaceActivityContentState or liveSurfaceStage in packages/surface-contracts/src/schema.ts, then run pnpm surface:codegen to regenerate both files. CI gates codegen drift at stage 2 and byte-identity + Zod parity at stage 3. The follow-up plan to consolidate this duplication into a local Swift Package is upstream-blocked on @bacons/apple-targets local-SPM support and RN 0.84 local-path spm_dependency landing in Expo SDK 56; codegen is the intermediate state until that unblocks.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms002-activitykit-attribute-file-byte-identity"
    ),
    "MS003": MSTrapBinding(
      id: "MS003",
      title: "Swift ContentState fields and JSON keys match Zod liveSurfaceActivityContentState",
      severity: "error",
      detection: "static",
      summary: "MobileSurfacesActivityAttributes.ContentState must declare the same fields, types, and JSON keys as liveSurfaceActivityContentState in packages/surface-contracts/src/schema.ts. Both Swift attribute files participate; the JSON-key shape is what ActivityKit decodes from the push payload.",
      symptom: "Push lands at APNs (200) but the Lock Screen view stays on its old state. The Codable decoder silently fails on a renamed key or a type mismatch and ActivityKit drops the update without surfacing an error.",
      fix: "Update the Zod source first, regenerate the JSON Schema (pnpm surface:check), then mirror the field change into both Swift attribute files. Project payloads through toLiveActivityContentState rather than hand-rolling JSON so the JS layer cannot diverge from the contract.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms003-swift-contentstate-fields-and-json-keys-match-zod-livesurfaceactivitycontentstate"
    ),
    "MS004": MSTrapBinding(
      id: "MS004",
      title: "Swift Stage enum cases match Zod liveSurfaceStage",
      severity: "error",
      detection: "static",
      summary: "The Stage enum in MobileSurfacesActivityAttributes.swift must cover exactly the cases listed in liveSurfaceStage.",
      symptom: "ContentState decodes but the stage value falls back to a default. Your Lock Screen never shows 'completing' even after the job is done.",
      fix: "Add or remove cases in lockstep: Zod first, regenerate the schema, mirror into both Swift files.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms004-swift-stage-enum-cases-match-zod-livesurfacestage"
    ),
    "MS005": MSTrapBinding(
      id: "MS005",
      title: "Retired rule (id reserved)",
      severity: "info",
      detection: "advisory",
      summary: "Reserved id. The original rule was removed before its prose was preserved in git history; the id is held back so external references (PR comments, log lines, blog posts citing MS005) keep resolving to a known marker rather than collide with a future rule.",
      symptom: "n/a (retired).",
      fix: "n/a (retired). Numbering policy: trap ids are monotonic forever; deletions reserve the id with deprecated: true.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms005-retired-rule-id-reserved"
    ),
    "MS006": MSTrapBinding(
      id: "MS006",
      title: "Generated JSON Schema must match Zod source",
      severity: "error",
      detection: "static",
      summary: "packages/surface-contracts/schema.json must be regenerated whenever the Zod source changes; CI fails if the committed file is stale.",
      symptom: "Backends validating with Ajv or jsonschema accept payloads the runtime then rejects (or vice versa). Consumers pinning the unpkg URL get out-of-date validation.",
      fix: "Run node --experimental-strip-types scripts/build-schema.mjs and commit the result.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms006-generated-json-schema-must-match-zod-source"
    ),
    "MS007": MSTrapBinding(
      id: "MS007",
      title: "All committed fixtures must parse as LiveSurfaceSnapshot",
      severity: "error",
      detection: "static",
      summary: "Every JSON file under data/surface-fixtures/ must parse via the v3 discriminated union (after $schema is stripped).",
      symptom: "Tests that exercise fixtures pass locally but fail in CI on a fixture nobody noticed was malformed; or fixture-driven previews silently render placeholder data.",
      fix: "Run pnpm surface:check and address any reported issues. Update data/surface-fixtures/index.json if the fixture was newly added.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms007-all-committed-fixtures-must-parse-as-livesurfacesnapshot"
    ),
    "MS008": MSTrapBinding(
      id: "MS008",
      title: "Snapshot kind must match its projection slice",
      severity: "error",
      detection: "static",
      summary: "kind: 'widget' requires a widget slice; kind: 'control' requires a control slice; kind: 'notification' requires a notification slice.",
      symptom: "safeParse throws a discriminated-union error at the wire boundary; or worse, an old code path bypasses safeParse and a missing slice causes downstream surfaces to render placeholder data.",
      fix: "Pair every kind change with its slice. Use the projection helper for the kind (toWidgetTimelineEntry, toControlValueProvider, toNotificationContentPayload) rather than reaching into the snapshot directly.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms008-snapshot-kind-must-match-its-projection-slice"
    ),
    "MS009": MSTrapBinding(
      id: "MS009",
      title: "Generated TypeScript fixtures must match JSON sources",
      severity: "error",
      detection: "static",
      summary: "packages/surface-contracts/src/fixtures.ts is generated from data/surface-fixtures/*.json and must not drift.",
      symptom: "Test imports reference the TS fixtures but get a stale shape; the harness shows different state than the fixture file on disk.",
      fix: "Run node scripts/generate-surface-fixtures.mjs and commit. CI runs the same with --check.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms009-generated-typescript-fixtures-must-match-json-sources"
    ),
    "MS010": MSTrapBinding(
      id: "MS010",
      title: "Toolchain preflight (Node 24, pnpm, Xcode 26+)",
      severity: "warning",
      detection: "config",
      summary: "pnpm dev:doctor verifies Node 24, pnpm 10, Xcode major 26+, and simulator availability before iOS work begins.",
      symptom: "Builds fail with confusing Swift compiler errors, simulator launches that hang, or pnpm refusing to install. None of which point at the actual cause (a stale toolchain row).",
      fix: "Run pnpm dev:doctor. Update Xcode and re-run if the major version is below 26. Use Node 24.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms010-toolchain-preflight-node-24-pnpm-xcode-26"
    ),
    "MS011": MSTrapBinding(
      id: "MS011",
      title: "ActivityKit payload size ceiling (4 KB / 5 KB broadcast)",
      severity: "error",
      detection: "runtime",
      summary: "Per-activity Live Activity pushes are bounded at 4 KB; iOS 18 broadcast pushes at 5 KB. Standard notification alert pushes (push-type alert, kind notification) share the 4 KB ceiling; the 5 KB allowance is ActivityKit-broadcast-only and does not apply to sendNotification.",
      symptom: "APNs returns 413 PayloadTooLarge, or accepts the payload but iOS silently drops the update. Long localized strings or accumulated morePartsCount details are common offenders.",
      fix: "Trim the payload. Per-activity payloads are bounded at 4 KB; broadcast payloads at 5 KB. Shorten the liveActivity slice's body, lower morePartsCount, or split a state into two smaller pushes. Validate by sending the projection through toLiveActivityContentState and measuring.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms011-activitykit-payload-size-ceiling-4-kb-5-kb-broadcast"
    ),
    "MS012": MSTrapBinding(
      id: "MS012",
      title: "iOS deployment target must be 17.2 or higher",
      severity: "error",
      detection: "config",
      summary: "Mobile Surfaces commits to push-to-start tokens (Activity<...>.pushToStartTokenUpdates) without if #available ceremony; deployment target below 17.2 breaks the live-activity adapter at compile time.",
      symptom: "Swift compile errors on pushToStartTokenUpdates references, or a build that succeeds on a lower target only because the symbol was guarded, and then push-to-start silently never works on iOS 16 devices.",
      fix: "Set ios.deploymentTarget to '17.2' in apps/mobile/app.json (or via expo-build-properties) and rerun prebuild.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms012-ios-deployment-target-must-be-17-2-or-higher"
    ),
    "MS013": MSTrapBinding(
      id: "MS013",
      title: "App Group entitlement must match host app and widget extension",
      severity: "error",
      detection: "static",
      summary: "apps/mobile/app.json is the single source of truth for the App Group identifier. The widget entitlements file at apps/mobile/targets/widget/generated.entitlements, the Swift constant at apps/mobile/targets/_shared/MobileSurfacesAppGroup.swift, and the TS constant at apps/mobile/src/generated/appGroup.ts are codegened from it and must not be hand-edited. check-app-group-identity is the defense-in-depth identity check across the four declaration sites; the primary enforcer is the generate-app-group-constants --check gate at stage 2.",
      symptom: "Widget renders placeholder forever; control widget never reads the toggle state. No error: the entitlement mismatch makes both sides read separate App Group containers.",
      fix: "Edit app.json and run pnpm surface:codegen to regenerate the Swift constant, TS constant, and widget entitlements in lockstep. Rename across every site via pnpm surface:rename. Hand edits to the generated files revert on the next codegen and fail the stage-2 drift gate.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms013-app-group-entitlement-must-match-host-app-and-widget-extension"
    ),
    "MS014": MSTrapBinding(
      id: "MS014",
      title: "APNs token environment must match the build environment",
      severity: "error",
      detection: "runtime",
      summary: "Tokens minted by a development build cannot authenticate against the production APNs endpoint, and vice versa.",
      symptom: "APNs responds 400 BadDeviceToken. The token is valid; it just belongs to the other environment.",
      fix: "Use environment: 'development' for dev-client and expo run:ios builds, environment: 'production' only for TestFlight and App Store builds. Track which environment minted each token.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms014-apns-token-environment-must-match-the-build-environment"
    ),
    "MS015": MSTrapBinding(
      id: "MS015",
      title: "Push priority 5 vs 10 budget rules",
      severity: "warning",
      detection: "runtime",
      summary: "Live Activity priority 10 is for immediate user-visible updates and is heavily budgeted by iOS; sustained priority 10 sends are silently throttled.",
      symptom: "Updates land for the first few pushes then mysteriously stop arriving on the device. APNs returns 200; iOS still drops them. Logs show TooManyRequests bursts.",
      fix: "Default to priority 5 for Live Activity content-state updates. Reserve priority 10 for state transitions the user must see immediately (queued→active, completed).",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms015-push-priority-5-vs-10-budget-rules"
    ),
    "MS016": MSTrapBinding(
      id: "MS016",
      title: "Subscribe to onPushToStartToken at mount, not on demand",
      severity: "error",
      detection: "runtime",
      summary: "iOS only delivers push-to-start tokens through Activity<...>.pushToStartTokenUpdates as an async sequence; getPushToStartToken() always resolves null.",
      symptom: "Backend never receives a push-to-start token, or only receives one after a manual app re-launch. Remote Live Activity start never fires for users who have not opened the app since install.",
      fix: "Subscribe via liveActivityAdapter.addListener('onPushToStartToken', ...) inside a mount-time effect. Re-store the token on every emission, since Apple may rotate at cold launch or system rotation.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms016-subscribe-to-onpushtostarttoken-at-mount-not-on-demand"
    ),
    "MS017": MSTrapBinding(
      id: "MS017",
      title: "apps/mobile/ios/ is generated; do not edit",
      severity: "error",
      detection: "advisory",
      summary: "Continuous Native Generation rebuilds apps/mobile/ios/ from app.json, packages/live-activity/, and apps/mobile/targets/widget/. Manual edits are wiped on the next prebuild.",
      symptom: "An Xcode change you made to fix a build issue disappears after pnpm mobile:prebuild:ios and the original problem returns. Or the change persists locally but breaks every other contributor.",
      fix: "Edit the source files instead: app.json for plist/entitlements, packages/live-activity/ios/ for native module Swift, apps/mobile/targets/widget/ for the WidgetKit target. Then rerun prebuild.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms017-apps-mobile-ios-is-generated-do-not-edit"
    ),
    "MS018": MSTrapBinding(
      id: "MS018",
      title: "APNS_BUNDLE_ID must not include the .push-type.liveactivity suffix",
      severity: "error",
      detection: "runtime",
      summary: "The push SDK auto-appends .push-type.liveactivity to the apns-topic; passing it pre-suffixed produces a malformed topic header.",
      symptom: "APNs responds 400 TopicDisallowed even though your auth key is correctly enabled for the app. The topic header has the suffix doubled or in the wrong position.",
      fix: "Set APNS_BUNDLE_ID to the bare bundle id (e.g. com.example.mobilesurfaces). The SDK and scripts/send-apns.mjs both handle the suffix internally.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms018-apns-bundle-id-must-not-include-the-push-type-liveactivity-suffix"
    ),
    "MS019": MSTrapBinding(
      id: "MS019",
      title: "FB21158660: push-to-start tokens silent after force-quit",
      severity: "info",
      detection: "advisory",
      summary: "Apple-reported bug. After the user force-quits the app, pushToStartTokenUpdates may stop emitting until the next OS push wakes the app, but the previously-issued token still authenticates against APNs (200 response, no actual activity start).",
      symptom: "Backend successfully sends a remote start, gets 200, but the Lock Screen never shows the activity. User has force-quit the app since the last token rotation.",
      fix: "No client workaround. Document in customer-support runbooks: 'If the Lock Screen activity does not appear after a remote-start push, ask the user to open the app once.'",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms019-fb21158660-push-to-start-tokens-silent-after-force-quit"
    ),
    "MS020": MSTrapBinding(
      id: "MS020",
      title: "Per-activity and push-to-start tokens may rotate at any time",
      severity: "error",
      detection: "runtime",
      summary: "Both pushTokenUpdates and pushToStartTokenUpdates may emit fresh values at any moment (cold launch, system rotation, foreground transition).",
      symptom: "Backend send to a stored token returns 410 Unregistered or 400 BadDeviceToken on a previously-working device. The user did nothing wrong; the OS rotated the token.",
      fix: "Treat the latest event as authoritative. Re-store on every emission keyed by user/device id, and update the active record rather than appending.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms020-per-activity-and-push-to-start-tokens-may-rotate-at-any-time"
    ),
    "MS021": MSTrapBinding(
      id: "MS021",
      title: "Discard per-activity tokens when the activity ends",
      severity: "warning",
      detection: "runtime",
      summary: "Once onActivityStateChange reports 'ended' or 'dismissed', the per-activity push token is dead; sending to it is accepted by APNs (200) but iOS will not surface anything.",
      symptom: "Backend keeps spending sends on a token that produces no user-visible effect. No error, just silent drops.",
      fix: "Wire onActivityStateChange to your token store; mark tokens for the activity as terminal and stop selecting them for sends.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms021-discard-per-activity-tokens-when-the-activity-ends"
    ),
    "MS022": MSTrapBinding(
      id: "MS022",
      title: "Retired rule (merged into MS003)",
      severity: "info",
      detection: "advisory",
      summary: "Reserved id. The original rule was an early-draft duplicate of MS003 (Swift ContentState fields and JSON keys match Zod liveSurfaceActivityContentState) and was merged into it. See git commit d79ffb0.",
      symptom: "See MS003.",
      fix: "See MS003. Numbering policy: trap ids are monotonic forever; deletions reserve the id with deprecated: true.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms022-retired-rule-merged-into-ms003"
    ),
    "MS023": MSTrapBinding(
      id: "MS023",
      title: "Per-activity tokens are bound to a single Activity instance",
      severity: "warning",
      detection: "runtime",
      summary: "A new Activity.request mints a fresh per-activity token; tokens from a previous run cannot drive the new activity.",
      symptom: "Update lands at APNs (200) but appears not to do anything. Reading the harness shows a different per-activity token than what your backend stored.",
      fix: "Re-store on every onPushToken emission; treat tokens as activity-scoped, not user-scoped.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms023-per-activity-tokens-are-bound-to-a-single-activity-instance"
    ),
    "MS024": MSTrapBinding(
      id: "MS024",
      title: "Project must depend on @mobile-surfaces/surface-contracts (and push, when sending)",
      severity: "error",
      detection: "config",
      summary: "Foreign Expo projects auditing as Mobile Surfaces consumers must list the contract package; backends sending pushes must additionally list @mobile-surfaces/push.",
      symptom: "Type errors on snapshot helpers, or hand-rolled APNs code that diverges from the validated contract. The failure mode is wire-level drift between client and server.",
      fix: "Add @mobile-surfaces/surface-contracts on every layer that emits or consumes a snapshot. Add @mobile-surfaces/push on the backend. Both packages release together (linked group).",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms024-project-must-depend-on-mobile-surfaces-surface-contracts-and-push-when-sending"
    ),
    "MS025": MSTrapBinding(
      id: "MS025",
      title: "App Group declared in app.json",
      severity: "error",
      detection: "config",
      summary: "app.json must declare a com.apple.security.application-groups entry for widgets and controls to share state with the host app.",
      symptom: "Widget extension reads its placeholder snapshot, never the live one. Control toggle does nothing visible. No log message; the App Group is just absent.",
      fix: "Add the entitlement to apps/mobile/app.json under expo.ios.entitlements. Match it on the widget target's expo-target.config.js.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms025-app-group-declared-in-app-json"
    ),
    "MS026": MSTrapBinding(
      id: "MS026",
      title: "Widget target managed by @bacons/apple-targets",
      severity: "error",
      detection: "config",
      summary: "The Mobile Surfaces widget target lives outside the generated ios/ directory and is materialized by @bacons/apple-targets at prebuild time.",
      symptom: "Hand-managed Xcode target gets wiped on the next prebuild, or the widget extension never appears in the built app.",
      fix: "Keep the target source under apps/mobile/targets/widget/ with an expo-target.config.js. Pin @bacons/apple-targets at the supported exact version.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms026-widget-target-managed-by-bacons-apple-targets"
    ),
    "MS027": MSTrapBinding(
      id: "MS027",
      title: "Foreign Expo project must target iOS 17.2 or higher",
      severity: "error",
      detection: "config",
      summary: "Same constraint as MS012, applied during an audit of an arbitrary Expo project that adopts Mobile Surfaces.",
      symptom: "Audit fails with a deployment-target mismatch; a downstream prebuild surfaces compile errors on iOS 17.2-only symbols.",
      fix: "Set ios.deploymentTarget to '17.2' (or higher) in app.json or via expo-build-properties.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms027-foreign-expo-project-must-target-ios-17-2-or-higher"
    ),
    "MS028": MSTrapBinding(
      id: "MS028",
      title: "APNs auth key environment variables must be set before sending",
      severity: "error",
      detection: "runtime",
      summary: "Both the SDK and scripts/send-apns.mjs require APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH, and APNS_BUNDLE_ID.",
      symptom: "Throw at construction time (createPushClient) or at the first send. Often hidden inside a deployment whose env vars never made it into the runtime.",
      fix: "Verify each env var on startup. The SDK's createPushClient validates presence; reject fast if any are missing.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms028-apns-auth-key-environment-variables-must-be-set-before-sending"
    ),
    "MS029": MSTrapBinding(
      id: "MS029",
      title: "Generated apps/mobile/ios/ is gitignored",
      severity: "error",
      detection: "config",
      summary: "CNG-managed directories must not be checked into version control; commits will fight prebuild forever.",
      symptom: "Pull request diffs include hundreds of lines under apps/mobile/ios/ that nobody intended to change. Reviewers cannot tell what is real.",
      fix: "Add apps/mobile/ios/ to .gitignore. If files are already tracked, untrack with git rm -r --cached apps/mobile/ios then commit the .gitignore update.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms029-generated-apps-mobile-ios-is-gitignored"
    ),
    "MS030": MSTrapBinding(
      id: "MS030",
      title: "APNs provider token must be valid and current",
      severity: "error",
      detection: "runtime",
      summary: "APNs returns 403 with reason Forbidden, InvalidProviderToken, or ExpiredProviderToken when the auth-key JWT cannot be verified; each reason has a distinct operator response.",
      symptom: "All sends fail with 403. ForbiddenError means the auth key was revoked in the Apple Developer portal. InvalidProviderTokenError means the JWT is malformed or signed with the wrong key id / team id. ExpiredProviderTokenError means the JWT is older than 60 minutes (typically clock skew, since the SDK refreshes at 50 minutes).",
      fix: "ForbiddenError: mint a new auth key in the Apple Developer portal and update APNS_KEY_ID / APNS_KEY_PATH. InvalidProviderTokenError: verify APNS_KEY_ID matches the key file and APNS_TEAM_ID matches the developer account. ExpiredProviderTokenError: check system clock alignment against NTP; if the SDK is long-lived, confirm createPushClient is not being held past process restarts without re-minting.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms030-apns-provider-token-must-be-valid-and-current"
    ),
    "MS031": MSTrapBinding(
      id: "MS031",
      title: "Channel management failures (missing, malformed, or unregistered channel id)",
      severity: "error",
      detection: "runtime",
      summary: "Broadcast and channel-admin calls reject when the channel id is missing from the request, malformed on the wire, or refers to a channel that was never created in the target environment.",
      symptom: "Broadcast or channel management fails with 400 (missing or bad channel id) or 410 (not registered). Common root causes: the channel was created against the opposite APNs environment, or the id was URL-decoded, truncated, or otherwise mutated before being sent back.",
      fix: "MissingChannelId: pass channelId to broadcast() or deleteChannel(). BadChannelId: use the id returned by createChannel() verbatim with no URL-decoding or truncation. ChannelNotRegistered: channels are environment-scoped, so re-create the channel in the target environment or call listChannels() to confirm the id exists there.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms031-channel-management-failures-missing-malformed-or-unregistered-channel-id"
    ),
    "MS032": MSTrapBinding(
      id: "MS032",
      title: "Activity timestamp fields must be valid unix-seconds integers",
      severity: "error",
      detection: "runtime",
      summary: "APNs rejects Live Activity pushes whose date fields (staleDateSeconds, dismissalDateSeconds, apns-expiration) are not positive unix-seconds integers, and rejects broadcast sends to a no-storage channel that carry a nonzero apns-expiration.",
      symptom: "APNs returns 400 BadDate or 400 BadExpirationDate. The push payload looked valid locally but a date field was a millisecond timestamp, a negative number, or a non-integer; or apns-expiration was set on a no-storage broadcast channel.",
      fix: "Confirm every date field is a positive unix-seconds integer (not milliseconds, not Date.now()). For broadcast on a no-storage channel, apns-expiration must be 0; the SDK's broadcast() already enforces this.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms032-activity-timestamp-fields-must-be-valid-unix-seconds-integers"
    ),
    "MS033": MSTrapBinding(
      id: "MS033",
      title: "Retired rule (id reserved)",
      severity: "info",
      detection: "advisory",
      summary: "Reserved id. The original rule was removed before its prose was preserved in git history; the id is held back so external references (PR comments, log lines, blog posts citing MS033) keep resolving to a known marker rather than collide with a future rule.",
      symptom: "n/a (retired).",
      fix: "n/a (retired). Numbering policy: trap ids are monotonic forever; deletions reserve the id with deprecated: true.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms033-retired-rule-id-reserved"
    ),
    "MS034": MSTrapBinding(
      id: "MS034",
      title: "Broadcast capability must be enabled on the APNs auth key",
      severity: "error",
      detection: "runtime",
      summary: "iOS 18 broadcast pushes and channel-admin calls require the 'Broadcast to Live Activity' capability on the APNs auth key. The capability is per-key, not per-app, and is invisible until the first send fails.",
      symptom: "createChannel() or broadcast() fails with 403 FeatureNotEnabled. The auth key is otherwise valid and other push types succeed; only broadcast-related calls reject.",
      fix: "Enable broadcast in the Apple Developer portal under Certificates, Identifiers & Profiles > Keys > select the key > edit > tick 'Broadcast to Live Activity'. Save and retry; no client change is needed.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms034-broadcast-capability-must-be-enabled-on-the-apns-auth-key"
    ),
    "MS035": MSTrapBinding(
      id: "MS035",
      title: "apns-topic header missing or bundleId misconfigured",
      severity: "error",
      detection: "runtime",
      summary: "APNs requires an apns-topic header on every request; the SDK derives it from APNS_BUNDLE_ID and a missing or empty bundle id produces a malformed topic at send time.",
      symptom: "APNs returns 400 MissingTopic. The bundle id was unset or an empty string, so the SDK emitted only the .push-type.liveactivity suffix (or nothing) as the topic header.",
      fix: "Confirm APNS_BUNDLE_ID is set to the bare bundle identifier (e.g. com.example.app). Do not include the .push-type.liveactivity suffix; the SDK appends it internally. See MS018 for the inverse failure (suffix included by mistake).",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms035-apns-topic-header-missing-or-bundleid-misconfigured"
    ),
    "MS036": MSTrapBinding(
      id: "MS036",
      title: "Surface snapshot Swift structs match their Zod projection-output schemas",
      severity: "error",
      detection: "static",
      summary: "Every hand-maintained Codable struct in apps/mobile/targets/_shared/MobileSurfacesSharedState.swift that decodes a Zod projection-output schema (today: MobileSurfacesWidgetSnapshot, MobileSurfacesControlSnapshot, MobileSurfacesLockAccessorySnapshot, MobileSurfacesStandbySnapshot, mapping to liveSurfaceWidgetTimelineEntry, liveSurfaceControlValueProvider, liveSurfaceLockAccessoryEntry, liveSurfaceStandbyEntry in packages/surface-contracts/src/schema.ts) must declare the same fields, types, JSON keys, and optionality as its schema. New surfaces register their struct + schema pair in scripts/check-surface-snapshots.mjs's SURFACES list. This extends the MS003 guarantee from the Lock Screen to every non-Live-Activity surface.",
      symptom: "The widget, control, lock-accessory, or StandBy surface renders placeholder data forever. The host writes a snapshot into the App Group container, but JSONDecoder in the widget extension silently fails on a renamed key, a type mismatch, or an optionality mismatch and returns nil. No log, no error.",
      fix: "Update the Zod projection-output schema first (and the projection helper that feeds it), then mirror the field, type, JSON key, and optionality change into the matching struct in MobileSurfacesSharedState.swift. Run pnpm surface:check; check-surface-snapshots.mjs verifies all four structs against their schemas.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms036-surface-snapshot-swift-structs-match-their-zod-projection-output-schemas"
    ),
    "MS037": MSTrapBinding(
      id: "MS037",
      title: "Notification category outputs in sync with canonical registry",
      severity: "error",
      detection: "static",
      summary: "packages/surface-contracts/src/notificationCategories.ts is the single source of truth for every UNNotificationCategory identifier Mobile Surfaces ships. The generated TS constant at apps/mobile/src/generated/notificationCategories.ts (host registration), the Swift constant at apps/mobile/targets/_shared/MobileSurfacesNotificationCategories.swift (extension routing), and (when the file exists) the UNNotificationExtensionCategory array in apps/mobile/targets/notification-content/Info.plist are all codegened from it and must not be hand-edited. The schema enforces parity at the wire boundary by constraining liveSurfaceNotificationSlice.category to z.enum over the registry's ids.",
      symptom: "Notification arrives at the device with aps.category set, but the UNNotificationContentExtension is never invoked: the user sees the default system chrome instead of the surface-aware custom view. No log, no error - iOS silently falls back when the payload category does not match any registered UNNotificationExtensionCategory in the extension Info.plist.",
      fix: "Edit packages/surface-contracts/src/notificationCategories.ts and run pnpm surface:codegen to regenerate every consumer in lockstep. The schema-level z.enum constraint rejects payloads that name a category outside the registry, so the wire stays load-bearing for parity.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms037-notification-category-outputs-in-sync-with-canonical-registry"
    ),
    "MS040": MSTrapBinding(
      id: "MS040",
      title: "Swift trap-binding file byte-identity",
      severity: "error",
      detection: "static",
      summary: "MobileSurfacesTraps.swift must be byte-identical at three sites: packages/traps/swift/, packages/live-activity/ios/, apps/mobile/targets/_shared/. The canonical copy is generated from data/traps.json by scripts/generate-traps-package.mjs; the other two are byte-identity replicas so the native module pod and the widget/notification-content extensions all resolve the same MSTrapBinding table.",
      symptom: "Drift across the three copies means a native module rejection carries a different trapId than the host app expects, and the `[trap=MSXXX]` suffix protocol parses to inconsistent ids on the JS side. No crash; just diagnostic noise that points the operator at the wrong fix.",
      fix: "Run pnpm surface:codegen (which calls generate-traps-package) to regenerate all three from the canonical data/traps.json source.",
      docsUrl: "https://github.com/glendonC/mobile-surfaces/blob/main/CLAUDE.md#ms040-swift-trap-binding-file-byte-identity"
    )
  ]

  public static let byErrorCase: [String: String] = [
    "BadChannelIdError": "MS031",
    "BadDateError": "MS032",
    "BadDeviceTokenError": "MS014",
    "BadExpirationDateError": "MS032",
    "ChannelNotRegisteredError": "MS031",
    "ExpiredProviderTokenError": "MS030",
    "FeatureNotEnabledError": "MS034",
    "ForbiddenError": "MS030",
    "InvalidProviderTokenError": "MS030",
    "InvalidSnapshotError": "MS008",
    "MissingApnsConfigError": "MS028",
    "MissingChannelIdError": "MS031",
    "MissingTopicError": "MS035",
    "PayloadTooLargeError": "MS011",
    "TooManyRequestsError": "MS015",
    "TopicDisallowedError": "MS018",
    "UnregisteredError": "MS020"
  ]

  public static func find(_ id: String) -> MSTrapBinding? { all[id] }

  public static func find(forCase name: String) -> MSTrapBinding? {
    byErrorCase[name].flatMap { all[$0] }
  }
}

public extension MSTrapBound {
  var trapId: String? { MSTraps.byErrorCase[String(describing: self)] }
  var docsUrl: String? {
    MSTraps.find(forCase: String(describing: self))?.docsUrl
  }
}
