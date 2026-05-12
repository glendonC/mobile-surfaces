---
"create-mobile-surfaces": patch
---

Scope the preflight by whether `--no-install` was passed. Today every code path that hits `runPreflight` validates the full toolchain up front — macOS, Node, pnpm, Xcode 26+, simulator runtimes, CocoaPods — and a missing or-too-old build dependency hard-fails the run before the user can even see the scaffolded tree. That made sense when every invocation immediately ran install + prebuild, but it's wrong for `--no-install`: the user has explicitly opted out of the build step, so the Xcode / simulator / CocoaPods gate is gating a step that isn't going to happen.

`runPreflight` now splits checks into two groups. The scaffold-required group (macOS, Node, pnpm) still hard-fails — those gate the act of writing files. The build-required group (Xcode, simulator, CocoaPods) only hard-fails when install is going to follow; with `--no-install` set those failures downgrade to warnings, so the scaffold completes and the user sees the same diagnostic copy as an advisory ("Update via the Mac App Store before building iOS"). The default and `--install` paths are unchanged — they still hard-fail on a missing or too-old iOS toolchain.

This also unblocks `pnpm cli:smoke:monorepo` in CI, which spawns the CLI bin with `--no-install` on a runner that doesn't have Xcode 26 yet.
