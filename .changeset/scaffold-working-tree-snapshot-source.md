---
"create-mobile-surfaces": patch
---

Add an opt-in `MOBILE_SURFACES_SCAFFOLD_FROM_WORKING_TREE=1` env var to `copyTemplate`. When set, the dev-mode source copy captures the working tree (tracked + uncommitted + untracked-but-not-gitignored) via `git ls-files` instead of streaming `git archive HEAD`. The default and the user-facing CLI invocations are unchanged: nothing in `bin/index.mjs` or `template-manifest.mjs` sets the variable, so production scaffolding still materializes from HEAD exactly as before.

This exists to close a long-standing footgun in the snapshot-update flow. The scaffold test was reading `git archive HEAD`, so `SNAPSHOT_UPDATE=1` against an uncommitted source edit produced snapshots pinned to the pre-edit state; the regen drifted again the moment the edit was committed, forcing a second "regenerate snapshots" commit. With the env var wired into the snapshot test's update path, a single `SNAPSHOT_UPDATE=1 pnpm cli:test` captures the working-tree state, and the source edit + snapshot regen can land in one commit. Verification mode (no `SNAPSHOT_UPDATE`) still uses HEAD, so CI continues to catch "committed source drifted from snapshot" exactly as it does today.
