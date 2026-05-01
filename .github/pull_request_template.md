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

Run on a clean working tree against your default simulator. Paste the trailing line of each command's output, or check the box if you ran it and it passed.

- [ ] `pnpm surface:check`
- [ ] `pnpm typecheck`
- [ ] `pnpm dev:doctor` (only if scripts/ or toolchain assumptions changed)
- [ ] `pnpm mobile:prebuild:ios` (only if native target / module behavior changed)

## Manual verification

<!-- Lock Screen Live Activity, Dynamic Island compact/expanded/minimal, APNs smoke, harness flow, etc. Skip if docs- or tooling-only. -->

## Screenshots / logs

<!-- Optional. -->
