---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"create-mobile-surfaces": patch
---

Tighten the existing-expo and existing-monorepo error UX so a missing pnpm or CocoaPods on the user's PATH no longer falls through to the generic "a step failed" message. The existing-expo handler now mirrors the same PNPM_MISSING_TAG and COCOAPODS_MISSING_TAG arms the greenfield and monorepo handlers already had, so the user sees the same actionable "enable pnpm with corepack" / "install CocoaPods with brew" pointers regardless of which flow surfaces the missing tool.

Sharpen the applyFailed and applyInterrupted copy. Both messages now state explicitly that some edits may have landed (existing flows do not stage), and direct the user to git status plus the log to decide whether to fix and re-run or restore from git. Replaces "Something failed while applying changes" with a more direct "A step failed" lead.

Centralize the "Apply these changes?" recap confirm string in copy.mjs as `prompts.confirmExisting.message`, replacing the two hardcoded copies in existing-expo.mjs and existing-monorepo.mjs. Voice tuning now happens in one place.
