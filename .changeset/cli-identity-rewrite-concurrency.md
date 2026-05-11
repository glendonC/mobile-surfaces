---
"create-mobile-surfaces": patch
---

- `applyWidgetRename` now reads + rewrites widget-target files with bounded concurrency (matching `apply-monorepo`'s identity-rewrite pass). Previously every file was read serially through `fs.readFileSync`, blocking the event loop on widget trees with many text files.
- `detectPackageManager` walks parent directories with one `readdirSync` + `Set` membership per level instead of up to four `existsSync` calls per level. Drops the upward lockfile probe from O(levels * lockfiles) stat syscalls to O(levels) directory reads.
- `buildManifestFromLive` caches its result by `repoRoot` so repeated `loadTemplateManifest` calls in the same process (e.g. dev-smoke scripts, retried flows) reuse the parsed manifest instead of re-reading the 3-4 source files.
- `runStreamed` rejection errors now carry `err.logPath` (when the install log has been opened) so downstream handlers and stack traces point at the concrete log file without parsing surrounding output.
- `mode.mjs` no longer re-exports `renderRefuse` and `parsePnpmWorkspaceGlobs`. Tests and callers import directly from `./refuse.mjs` and `./workspace.mjs`, restoring `mode.mjs` to a pure detection module without presentation/utility coupling.
