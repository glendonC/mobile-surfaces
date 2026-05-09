# @mobile-surfaces/push

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
