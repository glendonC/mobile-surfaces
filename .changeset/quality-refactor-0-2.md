---
"@mobile-surfaces/surface-contracts": major
"@mobile-surfaces/design-tokens": major
"@mobile-surfaces/live-activity": major
"create-mobile-surfaces": major
---

Make the contract package consumable from plain Node backends, generalize it for multi-surface projections, and tighten correctness across the board.

- Build all three library packages to ESM `dist/` via tsup; drop raw `.ts` from `main`/`types`. JSON imports inlined at build, so consumers don't need Node 22+ import attributes. The `source` exports condition keeps Metro reading TS source for HMR.
- Replace the anemic `schema.json` with Zod v4 as the single source of truth: ships `assertSnapshot` / `safeParseSnapshot` / `liveSurfaceSnapshot`, generates a real JSON Schema (`unpkg.com/@mobile-surfaces/surface-contracts@1/schema.json`), and bumps the public contract to `schemaVersion: "1"`.
- Generalize `LiveSurfaceSnapshot` with a top-level `kind` discriminator, explicit `liveActivity` fixtures, optional widget/control/notification slices, and kind-gated projection helpers for Live Activity, widgets, controls, and notification content.
- CI guards: structural Swift ↔ Zod drift detector for `MobileSurfacesActivityAttributes.swift`, fixture filename collision detection, linked changeset group so contract bumps force a CLI republish.
- CLI: thread `appleTeamId` through the add-to-existing flow, rename `MobileSurfaces*` widget files to the user's identity in add-to-existing, fail-fast on missing pnpm / CocoaPods with a clear fix message, reject `com.example.*` placeholder bundle IDs at the prompt.
- Scripts: APNs response reasons translated to causes + fixes, JWT clock-skew warning when local clock differs from APNs `Date` header by more than 5 minutes, rename script is now idempotent (`.mobile-surfaces-identity.json` manifest) and supports `--dry-run`.
- Hygiene: `pnpm` is required (`only-allow pnpm` preinstall guard), CLI engines tightened to `>=24.0.0 <25`, `live-activity` peers pinned to the compatibility row (`expo>=54`, `react>=19`, `react-native>=0.81`), authors set on every package, CocoaPods podspec author/homepage corrected.
- Harness: Live Activity "no" hint now diagnoses the cause (Expo Go vs iOS < 16.2 vs settings toggle) instead of a fixed copy.
