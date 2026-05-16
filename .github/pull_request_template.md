## Summary

<!-- One paragraph: what changed and why. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / starter polish
- [ ] Docs only
- [ ] CI / tooling

## Two-consumer rule

If this PR adds a new abstraction (helper, type, contract field, adapter slot, config knob), name the two real call sites in this repo that need it. If only one exists, prefer inlining and revisit when a second consumer materializes. See [`CONTRIBUTING.md`](../CONTRIBUTING.md#two-consumer-rule).

- Consumer 1:
- Consumer 2:
- N/A — this PR doesn't add an abstraction.

## Non-goals check

- [ ] This PR does not add anything from the [What this is not](../README.md#what-this-is-not) list.

## Local checks

`pnpm release:dry-run` runs every gate CI would run (surface:check, typecheck, push tests, scripts tests, cli tests, scaffold snapshot, site build, pack-and-install smoke) in one shot. On a clean tree it also refreshes the bundled template tarball so the scaffold snapshot test matches what CI sees. First-time on a clone: run `pnpm setup:hooks` once to install the pre-push hook that runs this automatically.

- [ ] `pnpm release:dry-run` passes 7/7 gates
- [ ] `pnpm dev:doctor` (only if scripts/ or toolchain assumptions changed)
- [ ] `pnpm mobile:prebuild:ios` (only if native target / module behavior changed)

If dry-run fails on a generated-file gate (CLAUDE.md, AGENTS.md, @mobile-surfaces/traps bindings, surface fixtures, scaffold snapshots), run `pnpm release:fix` to regenerate everything in the right order, then re-run dry-run. The full workflow lives in [`CONTRIBUTING.md`](../CONTRIBUTING.md#branch-and-release-workflow).

## Manual verification

<!-- Lock Screen Live Activity, Dynamic Island compact/expanded/minimal, APNs smoke, harness flow, etc. Skip if docs- or tooling-only. -->

## Screenshots / logs

<!-- Optional. -->
