---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

Add a `setPrompts()` / `resetPrompts()` DI seam to `ui.mjs` so unit tests can inject stubs for the three @inquirer primitives (input, select, confirm) without driving an actual TTY. Live mode (the module default) is unchanged; tests opt in. Six new tests cover the askText / askConfirm / askSelect paths end-to-end: each bubbles an `ExitPromptError` thrown by the underlying primitive into `guard()` (which exits 0 with the "Cancelled" message), `ERR_USE_AFTER_CLOSE` takes the same path, and `askText` threads the adapted validator into `input` so accept returns `true` and reject returns the error string @inquirer/prompts expects.
