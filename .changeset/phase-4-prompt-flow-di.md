---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

create-mobile-surfaces: testable prompt flow.

Adds a small DI seam to the three prompt orchestrators (runPrompts, runExistingExpoPrompts, runMonorepoPrompts) so unit tests can drive them without going through @inquirer/prompts. Each function now accepts a `ui` parameter that defaults to the live ./ui.mjs module; bin/index.mjs and other production callers are unchanged. The orchestrators internally call `ui.askText` / `ui.askConfirm` / `ui.askSelect` / `ui.log.*` / `ui.rail.*` / `ui.section` instead of imported bindings, and pass `ui` into recursive calls (the runPrompts retry path) and into the renderFoundRecap / renderPlanRecap helpers.

ui.mjs exports `guard` and `adaptValidate` so the cancellation contract (ExitPromptError + ERR_USE_AFTER_CLOSE → process.exit(0); other errors rethrown) and the validator-shape adapter can be unit-tested directly.

New prompts.test.mjs adds 9 tests: three for adaptValidate, three for guard's exit/rethrow behavior, and three for the runPrompts orchestration (validator independence, --yes skips every prompt, rejected recap confirm restarts the flow).
