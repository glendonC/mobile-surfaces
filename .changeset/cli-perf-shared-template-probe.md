---
"create-mobile-surfaces": patch
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
---

Share the CLI's "are we in a published tarball or a live monorepo" probe across `resolveTemplateRoot` (template-manifest.mjs) and `resolveTemplateSource` (scaffold.mjs) via a single cached `resolveCliMode()` helper. Both call sites previously stat'd the same `template/` directory and `pnpm-workspace.yaml` independently; the cache runs the probe once per process.

In `gatherExpoEvidence`, replace three sequential `existsSync` checks for `app.json` / `app.config.ts` / `app.config.js` with one `readdirSync`. Same priority order (json > ts > js), one syscall instead of up to three.
