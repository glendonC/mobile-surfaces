---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

create-mobile-surfaces: internal refactors with no behavior change.

- Split mode.mjs into focused modules. Workspace detection (pnpm-workspace.yaml + package.json `workspaces` parsing) moves to workspace.mjs, and package-manager detection (npm_config_user_agent + lockfile walk) moves to package-manager.mjs. mode.mjs now imports from both and re-exports parsePnpmWorkspaceGlobs for the existing test, but new code can target workspace.mjs directly without paying the cost of full mode detection.
- Consolidate the greenfield app.json triple-read in scaffold.renameIdentity. The rename-starter script writes app.json, then applyAppleTeamId and applyNewArchEnabled each did their own read-modify-write on the file we just touched; renameIdentity now uses an internal applyAppJsonPatches helper that batches both patches into a single read-modify-write. The exported applyAppleTeamId / applyNewArchEnabled functions stay for unit tests.
- Consolidate the apply-existing widget-rename walk. applyWidgetRename now collects {dir, name, newContent, newName} tuples in one walk and applies writes + renames in a coordinated sweep. Same external behavior; intent is clearer and the apply step is easier to reason about than per-file side effects mid-traversal.
