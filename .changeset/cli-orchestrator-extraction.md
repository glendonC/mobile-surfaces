---
"create-mobile-surfaces": patch
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
---

Split the dense orchestrators in apply-existing.mjs and apply-monorepo.mjs into per-step private helpers. `applyToExisting` (was ~110 lines, 5 concerns) now reads as three named function calls — `applyPackageInstall`, `applyAppConfigPatch`, `applyWidgetCopyStripRename`. `applyMonorepo` (was ~115 lines, 6 concerns) reads as `stageAndCopyAppsMobile`, `stripSurfacesAndMarkers`, `rewriteIdentityInTree`, `patchAppJsonStep`, `rewriteWorkspaceDeps`, `mergeHostWorkspace`. Each helper keeps the inline rationale comment that explained why the step exists. No behavior change; the test suite (218 tests) passes unchanged.
