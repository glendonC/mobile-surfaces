# @mobile-surfaces/traps

## 9.0.0

### Major Changes

- fe9eb25: Demote five doc-only rules from error or warning severity to info advisory: MS016, MS020, MS021, MS023, MS034. The rules remain in the catalog with their prose intact, but their severity now matches what the repo actually enforces. None of these rules has a static gate, an SDK pre-flight, or a runtime throw, so the prior error/warning severity over-promised enforcement. The MS-ids stay reserved per the monotonic-forever policy in CONTRIBUTING.md.

  Retire MS027 as a deprecated alias of MS012. Both rules fired the same iOS 17.2 deployment-target check on the same file; the catalog now counts the constraint once. MS027's id remains reserved and the catalog summary points at MS012.

  Public-surface impact for @mobile-surfaces/traps consumers: filtering by severity returns four fewer error rules and two fewer warning rules; reading MS027 receives a deprecated entry pointing at MS012. Headline catalog counts become 39 live rules (31 error, 2 warning, 6 info) with 4 retired ids reserved.

### Minor Changes

- c696c1b: Promote MS026 (widget target managed by @bacons/apple-targets) from a warning-only emission to a fail. The check now fires as a build failure when `apps/mobile/targets/widget/` exists but `expo-target.config.js` does not. A project that ships no widget target at all skips the check entirely.

  The catalog entry for MS026 gains an `enforcement.script` field pointing at `scripts/probe-app-config.mjs`, so `@mobile-surfaces/traps` consumers reading the binding will now see the script reference where the field was previously absent. The MS026 severity was already `error`; this change brings the gate behavior into line with what the catalog has always claimed.

  Background: the spike for refactor-v9 Phase 1e confirmed that every Mobile Surfaces scaffold variant lands `expo-target.config.js` regardless of the home-widget or control-widget toggles, so the file's absence in a starter-shaped project signals a deliberate removal of the config (not the toggling-off of widget surfaces). For foreign Expo projects audited via the catalog, the new conditional means projects without a widget target dir are not penalized.

- 15310fe: Add MS044 to the trap catalog: catalog headline counts stay in sync with the trap catalog. The rule is enforced by `scripts/generate-catalog-stats.mjs`, which generates `data/catalog-stats.json` (the canonical breakdown of total, live, deprecated, severity, detection, and PR-gated counts) and rewrites the `catalog-stats:` marker blocks in `README.md` and the doc site. A rule added, retired, or reclassified now fails the build unless every published count is regenerated alongside it.

  Public-surface impact for `@mobile-surfaces/traps` consumers: `TRAP_BINDINGS` and the `TrapId` union gain `MS044`; filtering by severity returns one more `error` rule and filtering by detection one more `static` rule. Headline catalog counts become 40 live rules (32 error, 2 warning, 6 info) with 4 retired ids reserved.

- 11495c3: Repoint MS036 (surface snapshot Swift structs match their Zod projection-output schemas) at `scripts/generate-surface-swift.mjs`.

  The four surface snapshot structs and the notification-content entry struct are now generated from their Zod schemas instead of hand-maintained. The structs are correct by construction; the single remaining failure mode — a committed Swift file drifting from the generator output — is caught by `generate-surface-swift.mjs --check`. The standalone semantic parity checker `check-surface-snapshots.mjs` is retired.

  Public-surface impact for `@mobile-surfaces/traps` consumers: `findTrap("MS036").enforcement.script` changes from `scripts/check-surface-snapshots.mjs` to `scripts/generate-surface-swift.mjs`, and the rule's `summary` and `fix` prose now describe the generated structs and the codegen workflow.

### Patch Changes

- e4cb220: Correct the MS041 prose. The rule's `summary` and `fix` described schemaVersion as needing to be the _first_ property of every projection-output schema and called that ordering "load-bearing." The enforcement check stopped requiring property order in v9 (Swift Codable decodes by key name, so source order never reached the wire); the literal-type check is the load-bearing part. The catalog text now matches the shipped gate.
- 66d5702: Reword the MS042 `symptom` prose. It used `schema-v4.ts` and `safeParseAnyVersion` as a concrete example; both were removed when the v4 codec was dropped at 9.0, so the example named a file that no longer exists. The symptom now describes the failure mode in version-neutral terms. No change to the rule, its severity, or its enforcement.

## 8.0.0

### Major Changes

- c347e54: v3 codec retirement. Per the versioning charter, a deprecated codec lives for at least one major past the release that deprecated it; v3 was first deprecated at 5.0 and ages out at 8.0.

  surface-contracts drops `liveSurfaceSnapshotV3`, `migrateV3ToV4`, `LiveSurfaceSnapshotV3`, the `V3_DEPRECATION_WARNING` constant, and the v3 branch in `safeParseAnyVersion`. The codec chain narrows to v5 → v4. The v4 codec's deprecation prose moves from "removed in 8.0.0" to "removed in 9.0.0" so the MS042 gate stays satisfied.

  Consumers with v3 payloads at rest must pin `@mobile-surfaces/surface-contracts@7.x` once, run `safeParseAnyVersion` to promote v3 → v5, store the result, then upgrade.

  `schemaVersion` stays at `"5"`. This release is codec retirement, not a wire-format bump.

  `@mobile-surfaces/validators` and `@mobile-surfaces/traps` cut majors in lockstep per the linked release group with no API change of their own.

  `@mobile-surfaces/push`, `@mobile-surfaces/live-activity`, `@mobile-surfaces/tokens`, and `create-mobile-surfaces` cut minors for the linked dependency range update; no API change.

## 7.0.0

### Major Changes

- Initial release. `@mobile-surfaces/traps` is the source of truth for every `MobileSurfacesError` subclass and its catalog binding. Exports:

  - `MobileSurfacesError` — base class for every typed error in the Mobile Surfaces packages. Carries `trapId`, `docsUrl`, and `cause` as getters resolved against the trap catalog.
  - `TrapBinding`, `TrapBound` — interfaces a host class declares to bind itself to a trap id.
  - `TrapIds` — const map of every trap id to its catalog metadata; generated from `data/traps.json`.
  - `findTrap(id)` — lookup a trap by id.
  - `findTrapByErrorClass(klass)`, `trapIdForErrorClass(klass)`, `docsUrlForErrorClass(klass)` — reverse lookups for catalog citations on a host error class.
  - `docsUrlFor(trapId)` — single URL builder for the docs site link a trap entry resolves to.

- The package ships a Swift companion (`MobileSurfacesTraps.swift`) that mirrors the TS bindings table for the native module. The file is byte-identical at three sites (`packages/traps/swift/`, `packages/live-activity/ios/`, `apps/mobile/targets/_shared/`); the byte-identity gate (MS040, `scripts/check-traps-swift-byte-identity.mjs`) catches drift.

- The canonical TS bindings under `src/generated/bindings.ts` and the Swift companion are generated by `scripts/generate-traps-package.mjs` from `data/traps.json`. The generator consolidates the earlier per-asset generators (`generate-trap-bindings.mjs`, `generate-traps-data.mjs`) behind one entry point.

- The package is part of the linked release group with `@mobile-surfaces/surface-contracts` and `@mobile-surfaces/validators`. The three packages cut a coordinated major when the wire-format contract or trap catalog shifts.
