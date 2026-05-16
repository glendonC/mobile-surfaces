# @mobile-surfaces/push

## 6.0.0

### Major Changes

- Linked-group bump for the v5 schema release in `@mobile-surfaces/surface-contracts`. No SDK API change. The expired-JWT retry path now refreshes the provider token immediately on the first `ExpiredProviderTokenError` rather than waiting for the 50-minute scheduler tick, closing a window where a long-lived client held an expired JWT past the 60-minute boundary and saw the first send of the next minute fail. The notification-alert path is updated to match the v5 projection-output sidecar's `kind: "surface_snapshot"` literal so `liveActivityAlertPayload` and `toNotificationContentPayload` produce the same `liveSurface.kind` value.

## 4.0.0

### Major Changes

- Linked-group bump for the v3 schema release in `@mobile-surfaces/surface-contracts`. No SDK API change; `zod` is now declared as a peer dependency (the SDK had been importing it via the contract package's hoisted node_modules, which broke under strict pnpm config). The "zero npm runtime dependencies" headline is corrected to "wire-layer code only, zod as peer." The legacy `retryPolicy` option name is soft-deprecated; rename to `_unsafeRetryOverride`. `MOBILE_SURFACES_PUSH_DISABLE_RETRY=1` env var disables retries entirely (useful for tests).

## 3.2.0

### Minor Changes

- b6f4eb5: Retire `@mobile-surfaces/design-tokens`.

  The package was a 12-line re-export of a JSON file with one local consumer (the demo app's brand palette) and a single widget-config require for two hex values. It carried no contract, no Swift bytes, no schema — just cosmetic colors. The indirection earned nothing it cost: every release bumped a version that nobody else imported, snapshot tests pinned its presence in the scaffold, and the cohort of "@mobile-surfaces/\*" packages a foreign integrator audited for grew by one for no real value.

  Consumers: there are no published consumers we know of (no docs ever advertised direct use, and the package's exports were unused outside the demo app). If you do import `surfaceColors` / `swiftAssetColorMap` directly, copy the values from this commit's `apps/mobile/src/theme.ts` and inline them — they are 12 hex strings.

  The remaining packages co-version on the linked release group. The CLI's bundled template manifest drops the design-tokens row on the next `build:template` run.

### Patch Changes

- Updated dependencies [b6f4eb5]
  - @mobile-surfaces/surface-contracts@3.2.0

## 3.1.1

### Patch Changes

- e582058: Audit follow-up hardening across the check scripts, CLI safety, and push SDK test coverage.

  The MS003 `check-activity-attributes` script now parses Swift `CodingKeys` and compares on JSON key rather than the Swift identifier, closing the silent class of failure where a `case headline = "title"` remap stayed byte-identical across both attribute files but broke ActivityKit decode. The parser handles auto-synthesized CodingKeys, raw-value remaps, multi-case declarations, partial enums (properties excluded from CodingKeys are flagged as never-serialized), and CodingKeys declared in a sibling extension.

  The `create-mobile-surfaces` add-to-existing apply now snapshots every file or directory it is about to touch and rolls back on any thrown error from the apply phase. A failed `pnpm add` or partial widget rewrite no longer leaves the user with a half-patched project. The backup directory is removed on commit and on rollback regardless of per-entry errors so a rerun starts clean.

  Adds subprocess-driven negative tests for `check-adapter-boundary`, `check-activity-attributes`, and `check-app-group-identity` (previously untested), and end-to-end coverage for the push SDK's expired-JWT retry path and broadcast/channel failure modes (`FeatureNotEnabled`, `ChannelNotRegistered`, `BadChannelId`, `CannotCreateChannelConfig`).

  No public API surface changed. Internal test seams in `packages/push/src/client.ts` are symbol-keyed (`TEST_TRANSPORT_OVERRIDE`) and cannot be reached from production callers.

- Updated dependencies [e582058]
  - @mobile-surfaces/surface-contracts@3.1.1

## 3.1.0

### Minor Changes

- SDK ergonomics pass focused on backend observability and operator dry-runs.

  - Every `ApnsError` now exposes `docsUrl`, a stable GitHub anchor URL pointing at the rendered trap catalog entry for the failure. The URL travels alongside `trapId` so log aggregators can stamp both without juggling two maps. New helpers `findTrap(trapId)`, `findTrapByErrorClass(className)`, and `docsUrlForErrorClass(className)` are exported, backed by a generated `TRAP_BINDINGS` table that ships only the catalog subset reachable through a typed error class. The generator anchors URLs against the same slug algorithm `scripts/build-agents-md.mjs` uses, so the URLs line up with the CLAUDE.md table of contents.

  - Send methods now return `PushResult` with `attempts`, `latencyMs`, `retried[]`, and `trapHits[]` populated. `attempts` is 1-indexed (1 on first-try success), `retried[]` records each retried attempt's reason, status, backoff, and trap id, and `trapHits[]` is the deduplicated set of trap ids touched along the way. `SendResponse` stays exported as a type alias so existing callers compile unchanged.

  - New `client.describeSend(input)` returns a side-effect-free preview of the request the matching `send()` would issue: method, path, push-type, topic, priority, expiration, payload bytes, and the MS011 ceiling status. No JWT is minted; no socket is opened. The discriminated input mirrors the public send signatures (`alert`, `update`, `start`, `end`, `broadcast`) so backends can preflight a send before paying for the round-trip.

  - Priority-aware retry stretch: priority 10 sends now clamp `maxRetries` to at most 2 and double both `baseDelayMs` and `maxDelayMs` to honor MS015's iOS budget rules. The base policy is unchanged for priority 5 sends (Live Activity content updates). The transformation is exported as `effectiveRetryPolicy(base, priority)` so callers can audit what the SDK will actually do.

  - The `retryPolicy` option renamed to `_unsafeRetryOverride`. Changing the retry policy is usually wrong — the defaults are tuned against MS015 and the priority-aware stretch — so the new name surfaces that risk at the call site. The legacy `retryPolicy` field still works in 3.x but logs a one-time deprecation per process and will be removed in 4.0.

  - New env-level kill-switch `MOBILE_SURFACES_PUSH_DISABLE_RETRY=1` (or any non-empty value) forces `maxRetries: 0` across every client in the process. Operators reach for this during an APNs incident where retries are amplifying load; it wins over any in-code override.

### Patch Changes

- Updated dependencies
  - @mobile-surfaces/surface-contracts@3.1.0

## 3.0.0

### Major Changes

- Add `liveActivityAlertPayload` (Zod schema) and `liveActivityAlertPayloadFromSnapshot` (helper). Moved here from `@mobile-surfaces/surface-contracts@2.x` where they were named `liveSurfaceAlertPayload` and `toAlertPayload`. The `aps` envelope is APNs wire format, not a contract concern; the helper now lives next to the SDK that sends it.

  The helper's argument type is `LiveSurfaceSnapshotLiveActivity` rather than the full `LiveSurfaceSnapshot` union; callers narrow at the call site (the SDK already does via `snapshot.kind === "liveActivity"`). The runtime kind check that the previous `toAlertPayload` carried is no longer the helper's job. The inner wire discriminator `kind: "surface_snapshot"` is unchanged so consumer apps that already parse alert payloads on-device keep working.

- `PushClient.alert()` now consumes the snapshot through `liveActivityAlertPayloadFromSnapshot` from this package rather than importing `toAlertPayload` from surface-contracts. No public-API behavior change; the same payload shape lands on APNs.

- v2 schema compatibility: `PushClient` accepts both v2 and v1 snapshots transparently. The SDK validates inputs through `liveSurfaceSnapshot.safeParse`, which now strictly accepts v2 only; v1 payloads need to be migrated upstream via `safeParseAnyVersion` from `@mobile-surfaces/surface-contracts`. The v1 codec lives for the entire 3.x release line.

## 2.1.1

### Patch Changes

- 870f437: Publish `@mobile-surfaces/validators` to npm for the first time. The package was extracted out of `create-mobile-surfaces` and `scripts/rename-starter.mjs` in an earlier commit, but the publish-pipeline plumbing (linked group membership, trusted-publisher configuration on npm, docs/release.md package list) was incomplete. The `Pack-and-install smoke` CI step fails on every PR until validators is on npm, because `pnpm pack` rewrites the CLI's `workspace:*` dep to a concrete `2.1.0` version that npm cannot resolve.

  Add `@mobile-surfaces/validators` to the linked release group so it versions in lockstep with the rest of the public Mobile Surfaces packages.

- Updated dependencies [870f437]
  - @mobile-surfaces/surface-contracts@2.1.1

## 2.1.0

### Minor Changes

- cdaa373: Add a client-side payload size pre-flight for MS011. Both `sendBroadcastUpdate` and the shared activity-send path now call `assertPayloadWithinLimit` after stringifying the APNs body and throw `PayloadTooLargeError` (status 413) when the payload exceeds the 4 KB per-activity ceiling or the 5 KB broadcast ceiling, instead of letting the request round-trip to APNs and come back as a 413. The error message names the actual byte count, the applicable limit, and the operation kind, and cites MS011 so callers can route it to the catalog entry. Callers that previously caught `PayloadTooLargeError` from APNs responses keep working; those that did not now see the same error class surfaced earlier and without burning an APNs round-trip.
- 4645fc6: Dedup concurrent dials in `Http2Client.#ensureSession()`. When N callers hit `#ensureSession` while no session is open, they now all await the same `#dial()` promise instead of each opening their own. The in-flight promise is held in a single slot cleared in `.finally`, so a failed dial doesn't poison subsequent attempts. Previously cold-start parallel sends cost N TLS handshakes for N concurrent requests; post-GOAWAY recovery cost an extra dial per recovering stream.

  Treat `NGHTTP2_INTERNAL_ERROR` on `ERR_HTTP2_STREAM_ERROR` as a retryable transport condition. Node surfaces session-level destruction as `ERR_HTTP2_SESSION_ERROR` when there's one in-flight stream, but as `NGHTTP2_INTERNAL_ERROR` on each stream when there are multiple. The single-stream path was already retried (the session-error code is in `RETRYABLE_TRANSPORT_CODES`); this aligns the parallel-stream path with the same behavior.

  Add two test scenarios to `packages/push/test/client.test.mjs`: cold-start parallel sends share a single dial; parallel stream-resets recover via a single shared warm session. The first test would have caught the dial-dedup gap (sessionCount = 5 instead of 1 for 5 concurrent cold sends); the second pins the per-stream-reset recovery path.

- 7a5d0a1: Add three typed APNs error classes to @mobile-surfaces/push: `ForbiddenError`, `InternalServerError`, `ServiceUnavailableError`. The three reason strings were already in `APNS_REASON_GUIDE` and (for the latter two) in `DEFAULT_RETRYABLE_REASONS`, but `reasonToError` had no cases for them so they fell through to `UnknownApnsError`. Observability hooks can now discriminate the three with `instanceof`.

  Fix a retry gap on RST_STREAM. Node wraps a per-stream reset as `ERR_HTTP2_STREAM_ERROR` and exposes the protocol-level code (`NGHTTP2_REFUSED_STREAM`) in the message rather than on `err.code`, so a transient REFUSED_STREAM on a single stream was surfacing as a non-retryable error even though the protocol code is in `RETRYABLE_TRANSPORT_CODES`. `isTransportError` now recognizes that wrapper. The mock APNs server gained a `rstStream` flag and the client test suite pins the new retry path.

  Add an inline invariant comment on `JwtCache.get()` explaining why `mintJwt` must stay synchronous (a future `await` between the freshness check and the `#entry` assignment would let two concurrent `get()` calls both re-mint).

### Patch Changes

- 4645fc6: Split the dense orchestrators in apply-existing.mjs and apply-monorepo.mjs into per-step private helpers. `applyToExisting` (was ~110 lines, 5 concerns) now reads as three named function calls — `applyPackageInstall`, `applyAppConfigPatch`, `applyWidgetCopyStripRename`. `applyMonorepo` (was ~115 lines, 6 concerns) reads as `stageAndCopyAppsMobile`, `stripSurfacesAndMarkers`, `rewriteIdentityInTree`, `patchAppJsonStep`, `rewriteWorkspaceDeps`, `mergeHostWorkspace`. Each helper keeps the inline rationale comment that explained why the step exists. No behavior change; the test suite (218 tests) passes unchanged.
- 4645fc6: Share the CLI's "are we in a published tarball or a live monorepo" probe across `resolveTemplateRoot` (template-manifest.mjs) and `resolveTemplateSource` (scaffold.mjs) via a single cached `resolveCliMode()` helper. Both call sites previously stat'd the same `template/` directory and `pnpm-workspace.yaml` independently; the cache runs the probe once per process.

  In `gatherExpoEvidence`, replace three sequential `existsSync` checks for `app.json` / `app.config.ts` / `app.config.js` with one `readdirSync`. Same priority order (json > ts > js), one syscall instead of up to three.

- 4645fc6: Add a `withStubbedPrompts(overrides, fn)` helper to ui.mjs that wraps the setPrompts/try/finally/resetPrompts pattern. The reset is now structural rather than a discipline that a future contributor could omit. Migrate the six existing prompt-stubbing tests in prompts.test.mjs onto the helper.

  Add a live inquirer retry-loop test using `@inquirer/testing`'s virtual-stream renderer. The existing DI-seam tests pin the contract shape (adaptValidate returns a string on reject) but never exercise the real `@inquirer/prompts.input` retry loop. The new test drives the prompt end-to-end: type a rejected value, observe the re-ask, type an accepted value, observe resolution. A future inquirer release that changed its validator contract (return string -> retry) would fail this test where the stubs would still pass.

- 5067bde: CLI consistency pass across the three scaffolding modes:

  - `renderRefuse` now throws on an unknown `evidence.reason` instead of silently falling back to the no-package-json copy. A future refuse branch added without updating the switch will surface as a loud bug rather than a misleading screen.
  - The invalid-package-json refuse copy now names the file path and points at the common JSON syntax mistakes (trailing comma, unquoted key, unescaped quote), so a user who is not git-fluent has somewhere to start.
  - Recap field labels are lowercase across all three modes (greenfield's existing style), aligning existing-expo and existing-monorepo with prompts.mjs.
  - Plan-recap heading renamed from "What I'll add" to "Changes to apply" in existing-expo and existing-monorepo; "We'll add Mobile Surfaces" intro replaced with "Adds Mobile Surfaces". First-person voice is replaced with imperative across the consent moment.
  - `--team-id` flag help now names the 10-character length and explains the skip path ("omit to skip and set later in app.json's ios.appleTeamId").
  - existing-expo's success screen gains a "When you're ready" section (device run, APNs setup, real-device push) between "Try it now" and "Learn more", matching greenfield and monorepo.

- 5067bde: surface-contracts: wrap the `liveSurfaceSnapshot` discriminated union in `z.lazy()` so the preprocess + discriminated-union construction is deferred to the first `parse` / `safeParse` call instead of running at module import. Backends that import the package but rarely validate, and short-lived serverless invocations that rarely hit the codepath, no longer pay the construction cost on cold start. `.parse` / `.safeParse` pass through transparently; the per-kind variant schemas stay eagerly built and unchanged.

  create-mobile-surfaces: tighten the apply phase for both existing-Expo and existing-monorepo flows so it walks each file once per substitution batch instead of N times. `rewriteContent` (apply-existing) now runs one regex pass with left-to-right alternation; `applySubstitutionsToString` (apply-monorepo) collapses literal substitutions into one alternation regex looked up via a Map. For the typical 6-literals + 1-regex monorepo rewrite, that drops from 7 passes to 2.

  create-mobile-surfaces: collapse the standalone `applyAppleTeamId` and `applyNewArchEnabled` helpers into a single exported `applyAppJsonPatches`. Production already used the batched form; the standalone helpers existed only to keep unit tests focused. Tests now drive `applyAppJsonPatches` directly and a new combined-pass test pins that both writes land in one read-modify-write.

  create-mobile-surfaces: add a decision-tree comment in `detectMode` so the precedence order is scannable without tracing, and reword `--no-new-arch` help to "use the legacy React Native bridge instead" rather than the bare "legacy bridge" jargon.

- b89b0fa: Tighten the existing-expo and existing-monorepo error UX so a missing pnpm or CocoaPods on the user's PATH no longer falls through to the generic "a step failed" message. The existing-expo handler now mirrors the same PNPM_MISSING_TAG and COCOAPODS_MISSING_TAG arms the greenfield and monorepo handlers already had, so the user sees the same actionable "enable pnpm with corepack" / "install CocoaPods with brew" pointers regardless of which flow surfaces the missing tool.

  Sharpen the applyFailed and applyInterrupted copy. Both messages now state explicitly that some edits may have landed (existing flows do not stage), and direct the user to git status plus the log to decide whether to fix and re-run or restore from git. Replaces "Something failed while applying changes" with a more direct "A step failed" lead.

  Centralize the "Apply these changes?" recap confirm string in copy.mjs as `prompts.confirmExisting.message`, replacing the two hardcoded copies in existing-expo.mjs and existing-monorepo.mjs. Voice tuning now happens in one place.

- 4092847: Pin eas-cli and typescript to exact versions in apps/mobile devDependencies (were ^16.25.1 and ^5.0.0). Matches the external-pin discipline already in place for @bacons/apple-targets and the workspace packages, so contributors no longer pick up transitive majors at install time.

  Add an explicit publishConfig.access "public" to create-mobile-surfaces so the publish workflow does not rely solely on the files allow-list. Matches the publishConfig block already present on the four runtime packages and makes a future maintainer's intent unambiguous.

- effc0f6: Add a `setPrompts()` / `resetPrompts()` DI seam to `ui.mjs` so unit tests can inject stubs for the three @inquirer primitives (input, select, confirm) without driving an actual TTY. Live mode (the module default) is unchanged; tests opt in. Six new tests cover the askText / askConfirm / askSelect paths end-to-end: each bubbles an `ExitPromptError` thrown by the underlying primitive into `guard()` (which exits 0 with the "Cancelled" message), `ERR_USE_AFTER_CLOSE` takes the same path, and `askText` threads the adapted validator into `input` so accept returns `true` and reject returns the error string @inquirer/prompts expects.
- 5067bde: - `check-trap-error-binding.mjs` now verifies that every ApnsError subclass cited in a trap's `errorClasses` array is reachable through `reasonToError`'s switch. The earlier check confirmed the class existed in errors.ts but said nothing about runtime dispatch; if a future trap added a new APNs reason without wiring `reasonToError`, observability hooks doing `err instanceof XxxError` would silently miss it.
  - Three new tests on `JwtCache` pin the synchronous-mint invariant documented in jwt.ts. Counting `crypto.createSign` calls catches the regression where a future `await` inside the mint branch would let two concurrent gets at the same now() both pass the freshness check and both mint.
- 4645fc6: Add trap entry MS030 (APNs provider token must be valid and current) and bind `ForbiddenError`, `InvalidProviderTokenError`, and `ExpiredProviderTokenError` to it. Observability hooks reading `err.trapId` now return `"MS030"` for these three 403 auth-failure modes instead of `undefined`, so log aggregators and the diagnose bundle can route them to the catalog entry. The catalog's fix section distinguishes the three operator responses (mint a new key vs verify key/team ids vs check clock skew).
- 5067bde: - `processFileContent` (strip.mjs) gains two edge-case tests: BEGIN/END marker id-set normalization (order-insensitive matching) and true nested regions where outer-strip swallows the inner, while outer-keep with inner-strip strips just the inner. Existing tests already covered single-id, multi-id sequential, unknown id, and unmatched begin/end. The new cases pin the id-set normalization invariant and nested-region handling so a future refactor cannot quietly regress either.
  - New push client test runs six sequential GOAWAY cycles back to back. Extends the existing two-cycle pin: the SDK must dial a fresh session per destroyed session for the full burst (sessionCount asserted at 7, requests at 12). Parallel-send-during-rotation was considered but left to the dedicated cold-start dedup test, since interleaving destroys with mid-flight parallel streams makes the assertion flaky against `maxRetries: 1`.
- Updated dependencies [4645fc6]
- Updated dependencies [4645fc6]
- Updated dependencies [4645fc6]
- Updated dependencies [5067bde]
- Updated dependencies [5067bde]
- Updated dependencies [cdaa373]
- Updated dependencies [b89b0fa]
- Updated dependencies [4092847]
- Updated dependencies [effc0f6]
- Updated dependencies [4645fc6]
- Updated dependencies [7a5d0a1]
- Updated dependencies [4645fc6]
  - @mobile-surfaces/surface-contracts@2.1.0

## 2.0.2

### Patch Changes

- 8dbe2ad: @mobile-surfaces/surface-contracts: bump JSON Schema $id from @1.2 to @2.0 so backends pinning the documented unpkg URL resolve to the actual released contract. scripts/build-schema.mjs now derives major.minor from packages/surface-contracts/package.json so the URL tracks the release train automatically; doc references in docs/architecture.md, docs/backend-integration.md, docs/roadmap.md, docs/schema-migration.md, and packages/surface-contracts/README.md are swept to match. Historical CHANGELOG entries are left at @1.2 for accuracy. Cross-references trap MS006.
- Updated dependencies [8dbe2ad]
  - @mobile-surfaces/surface-contracts@2.0.2

## 2.0.1

### Patch Changes

- b270fa1: Pin all dependencies to exact versions across packages and root devDependencies. Replaces caret/tilde ranges on zod, @inquirer/ansi, @inquirer/core, @inquirer/prompts, ora, picocolors, @types/node, and tsup so consumers no longer pick up transitive majors at install time.

  CLI improvements: the existing-expo and existing-monorepo plan recaps now echo the user's surface selections (live activity, home widget, control widget) before "Apply these changes?" so toggled-off surfaces are visible at confirmation. The existing-expo "What we found" recap leads with Config and Bundle id, demoting Expo version, ios/ folder, and plugins below the actionable fields. The bundle identifier validator now hints at reverse-DNS format ("Should be reverse-DNS (e.g. com.company.appname) with at least two segments"), and the Apple Team ID prompt points to developer.apple.com/account.

- 9bf2d87: @mobile-surfaces/push: production-readiness pass.

  - Add UnregisteredError typed class for APNs 410 responses and bind it to MS020. Backends can now distinguish a rotated or terminated token from genuinely unknown reasons without string-matching the reason field.
  - Close a narrow GOAWAY race in Http2Client. If APNs sent GOAWAY between session establishment and request dispatch, the SDK could issue a request on a session that had already been dropped from the cache. The request layer now validates the session is still current and re-dials once before dispatch, so a flapping connection surfaces as a transport error to the retry layer rather than racing.
  - Sanitize APNs key file errors. resolveKeyPem in @mobile-surfaces/push and the loadApnsKey helper in scripts/send-apns.mjs no longer surface the resolved absolute key path on read failure; ENOENT, EACCES, and EISDIR map to a path-free message. A 64 KB size guard rejects misconfigured paths early.
  - Document JWT cache concurrency. JwtCache is safe for concurrent in-flight requests on a single Node event loop but does not synchronize across worker_threads or cluster workers; the docstring now states the contract explicitly.
  - New transport tests: GOAWAY mid-flight reconnects on a fresh session; parallel sends multiplex over a single session; idle timeout closes the session and the next send reconnects; Http2Client surfaces per-request timeouts as ETIMEDOUT-coded errors.

- 72dee5f: create-mobile-surfaces: internal refactors with no behavior change.

  - Split mode.mjs into focused modules. Workspace detection (pnpm-workspace.yaml + package.json `workspaces` parsing) moves to workspace.mjs, and package-manager detection (npm_config_user_agent + lockfile walk) moves to package-manager.mjs. mode.mjs now imports from both and re-exports parsePnpmWorkspaceGlobs for the existing test, but new code can target workspace.mjs directly without paying the cost of full mode detection.
  - Consolidate the greenfield app.json triple-read in scaffold.renameIdentity. The rename-starter script writes app.json, then applyAppleTeamId and applyNewArchEnabled each did their own read-modify-write on the file we just touched; renameIdentity now uses an internal applyAppJsonPatches helper that batches both patches into a single read-modify-write. The exported applyAppleTeamId / applyNewArchEnabled functions stay for unit tests.
  - Consolidate the apply-existing widget-rename walk. applyWidgetRename now collects {dir, name, newContent, newName} tuples in one walk and applies writes + renames in a coordinated sweep. Same external behavior; intent is clearer and the apply step is easier to reason about than per-file side effects mid-traversal.

- 0166297: create-mobile-surfaces: testable prompt flow.

  Adds a small DI seam to the three prompt orchestrators (runPrompts, runExistingExpoPrompts, runMonorepoPrompts) so unit tests can drive them without going through @inquirer/prompts. Each function now accepts a `ui` parameter that defaults to the live ./ui.mjs module; bin/index.mjs and other production callers are unchanged. The orchestrators internally call `ui.askText` / `ui.askConfirm` / `ui.askSelect` / `ui.log.*` / `ui.rail.*` / `ui.section` instead of imported bindings, and pass `ui` into recursive calls (the runPrompts retry path) and into the renderFoundRecap / renderPlanRecap helpers.

  ui.mjs exports `guard` and `adaptValidate` so the cancellation contract (ExitPromptError + ERR_USE_AFTER_CLOSE → process.exit(0); other errors rethrown) and the validator-shape adapter can be unit-tested directly.

  New prompts.test.mjs adds 9 tests: three for adaptValidate, three for guard's exit/rethrow behavior, and three for the runPrompts orchestration (validator independence, --yes skips every prompt, rejected recap confirm restarts the flow).

- Updated dependencies [b270fa1]
- Updated dependencies [9bf2d87]
- Updated dependencies [72dee5f]
- Updated dependencies [0166297]
  - @mobile-surfaces/surface-contracts@2.0.1

## 2.0.0

### Major Changes

- 86f811a: Cut the linked release train at 2.0.0. The major bump is driven by `create-mobile-surfaces`; the runtime packages (`surface-contracts`, `design-tokens`, `live-activity`, `push`) align with the train.

  ## Breaking changes (`create-mobile-surfaces`)

  - **Exit-code contract canonicalized to 0 / 1 / 2 / 3 / 130.** CI consumers branching on specific codes will see a behavior change: refuse paths (e.g. invoking inside a non-Expo directory with files) now exit with `USER_ERROR` (1) instead of `ENV_ERROR` (2), matching the contract that exit 1 is "the user gave us a bad invocation" and exit 2 is "the environment is broken." The full contract: 0 success, 1 user error, 2 env error, 3 template error, 130 SIGINT. (#13, #28)

  ## New (`create-mobile-surfaces`)

  - **Non-interactive `--yes` mode** with full flag surface (`--name`, `--scheme`, `--bundle-id`, `--team-id`, `--home-widget` / `--no-home-widget`, `--control-widget` / `--no-control-widget`, `--install` / `--no-install`, `--new-arch` / `--no-new-arch`). Unlocks scripted and AI-agent usage. (#7, #24)
  - **Existing-monorepo-no-Expo scaffold mode.** Detects a TS monorepo without Expo and adds `apps/mobile/` plus the workspace globs needed for it; previously refused. (#8, #26)
  - **Atomic greenfield scaffold.** All work happens in a sibling staging directory; promotion to the user's chosen path is a final rename. Partial failure leaves the user's path untouched. (#12, #29)
  - `--new-arch` / `--no-new-arch` flag (and a prompt when interactive) for opting out of React Native's New Architecture. (#16)
  - Customize-further section in the post-scaffold success message and a CI invocation example in the README. (#17, #18)
  - `pnpm mobile:bootstrap` script that installs + first-prebuilds in one step. (#15)
  - Recursive identity rename across the whole tree (was previously an enumerated allowlist that drifted as files were added). (#5)
  - Source-first package `main` and `types` pointers, so typecheck no longer fails on the first run because workspace packages no longer claim unbuilt `dist/` artifacts. (#6)

  ## Bug fixes (`create-mobile-surfaces`)

  - Preflight now runs per-branch rather than upfront. A malformed `--yes` invocation surfaces as `USER_ERROR` (1) instead of being masked by an `ENV_ERROR` (2) from a toolchain check that didn't matter yet; refuse paths skip preflight entirely. (#35, #36)
  - `EPIPE` handler propagates a recorded failure code instead of silently exiting 0 when an earlier failure had already been recorded. (#19)
  - Preflight checks now use `Promise.allSettled` so a future check that forgets its try/catch can't abort every other check. (#20)
  - `apps/mobile/CHANGELOG.md` no longer ships with upstream release history (was getting confused with downstream user history). (#9)
  - `schema.json` `$id` is stripped during scaffold so the rendered URL doesn't dead-link after rename. (#10)
  - `appleTeamId: "XXXXXXXXXX"` placeholder is stripped when the user opts to skip. (#11)
  - TypeScript peer-dependency range widened to allow newer majors. (#14)
  - `rename-verify` ordering fixed for fresh scaffolds. (#23, #25)

  ## Test / CI infrastructure (`create-mobile-surfaces`)

  - `pnpm test:scripts` and `pnpm cli:test` now gate every PR (175+ tests previously local-only). (#31, #36)
  - Pack-and-install smoke catches publish-time breakage (`files:` field, missing `template/template.tgz`, shebang/permissions, workspace-only deps) at the tarball boundary. (#33, #37)
  - Fixture host repos under `test/fixtures/` plus integration tests at the detect→plan boundary for the three CLI scenarios. (#32, #38)
  - Scaffold-tree hash snapshots across the four surface combos catch unintended drift in what the scaffold materializes. (#34, #39)

  ## Runtime packages (`@mobile-surfaces/{surface-contracts,design-tokens,live-activity,push}`)

  Version bump driven by the `create-mobile-surfaces` 2.0.0 major. The runtime packages have no API changes since 1.3.0 and ship at 2.0.0 only because the linked release train moves all packages together. Consumers can update lockfiles without code changes.

### Patch Changes

- Updated dependencies [86f811a]
  - @mobile-surfaces/surface-contracts@2.0.0

## 1.3.0

### Minor Changes

- b717416: Add APNs setup wizard, surface picker, and observability foundations

### Patch Changes

- Updated dependencies [b717416]
  - @mobile-surfaces/surface-contracts@1.3.0

## 1.2.0

### Minor Changes

- 2de238f: Add `@mobile-surfaces/push`, the canonical Node SDK for sending Mobile Surfaces snapshots to APNs.

  - New package `@mobile-surfaces/push@0.1.0` ships `createPushClient` with `alert` / `update` / `start` / `end` / `broadcast` / `createChannel` / `listChannels` / `deleteChannel`. Drives the existing `LiveSurfaceSnapshot` projection helpers from `@mobile-surfaces/surface-contracts` at the wire layer.
  - Long-lived HTTP/2 session per `PushClient`, JWT cached with a 50-minute refresh window (10-minute safety buffer below Apple's 60-minute cap), retry policy with exponential backoff + jitter that honors `Retry-After` for 429s.
  - Full APNs error taxonomy (`BadDeviceTokenError`, `TooManyRequestsError`, `ChannelNotRegisteredError`, … 17 subclasses + `UnknownApnsError` fallback) plus `InvalidSnapshotError` and `ClientClosedError`. All carry `apnsId`, `status`, `reason`, `timestamp`.
  - Channel management routed to the documented split host/port: `api-manage-broadcast.sandbox.push.apple.com:2195` (development) and `api-manage-broadcast.push.apple.com:2196` (production).
  - Zero npm runtime deps — only the workspace `@mobile-surfaces/surface-contracts`. JWT signing is hand-rolled `node:crypto` ES256 (matching the proven `scripts/send-apns.mjs` implementation) for auditability.
  - `pnpm test:push` added to root, wired into CI and publish workflows.

  The new package is added to the linked release group so it versions in lockstep with the rest of `@mobile-surfaces/*` and `create-mobile-surfaces`.

### Patch Changes

- Updated dependencies [2de238f]
- Updated dependencies [2de238f]
  - @mobile-surfaces/surface-contracts@1.2.0
