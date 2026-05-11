---
"create-mobile-surfaces": patch
---

Add orchestrator-level prompt tests for the existing-expo and monorepo flows. Both have had the `ui = defaultUi` DI seam since the prompt-flow DI refactor landed, but neither had a single test exercising it. Coverage now matches `runPrompts`:

- Happy path through `runExistingExpoPrompts` and `runMonorepoPrompts` with scripted fake-ui answers.
- Recap declined exits `SUCCESS` instead of restarting (asymmetry with greenfield's recursive restart is now pinned by test).
- `ExitPromptError` thrown mid-flow exits `SUCCESS` through the live `guard()` wrapper, exercising the cancellation contract end-to-end for both flows.

Also adds one cancellation test for `runPrompts` (mid-flow `ExitPromptError` through the second text prompt), closing the last gap from the prompt-flow audit.
