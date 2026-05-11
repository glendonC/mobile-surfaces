---
"create-mobile-surfaces": patch
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
---

Add a `withStubbedPrompts(overrides, fn)` helper to ui.mjs that wraps the setPrompts/try/finally/resetPrompts pattern. The reset is now structural rather than a discipline that a future contributor could omit. Migrate the six existing prompt-stubbing tests in prompts.test.mjs onto the helper.

Add a live inquirer retry-loop test using `@inquirer/testing`'s virtual-stream renderer. The existing DI-seam tests pin the contract shape (adaptValidate returns a string on reject) but never exercise the real `@inquirer/prompts.input` retry loop. The new test drives the prompt end-to-end: type a rejected value, observe the re-ask, type an accepted value, observe resolution. A future inquirer release that changed its validator contract (return string -> retry) would fail this test where the stubs would still pass.
