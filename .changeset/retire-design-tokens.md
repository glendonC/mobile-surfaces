---
"@mobile-surfaces/surface-contracts": minor
"@mobile-surfaces/live-activity": minor
"@mobile-surfaces/push": minor
"@mobile-surfaces/validators": minor
"create-mobile-surfaces": minor
---

Retire `@mobile-surfaces/design-tokens`.

The package was a 12-line re-export of a JSON file with one local consumer (the demo app's brand palette) and a single widget-config require for two hex values. It carried no contract, no Swift bytes, no schema — just cosmetic colors. The indirection earned nothing it cost: every release bumped a version that nobody else imported, snapshot tests pinned its presence in the scaffold, and the cohort of "@mobile-surfaces/*" packages a foreign integrator audited for grew by one for no real value.

Consumers: there are no published consumers we know of (no docs ever advertised direct use, and the package's exports were unused outside the demo app). If you do import `surfaceColors` / `swiftAssetColorMap` directly, copy the values from this commit's `apps/mobile/src/theme.ts` and inline them — they are 12 hex strings.

The remaining packages co-version on the linked release group. The CLI's bundled template manifest drops the design-tokens row on the next `build:template` run.
