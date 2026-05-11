---
"create-mobile-surfaces": patch
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
---

CLI consistency pass across the three scaffolding modes:

- `renderRefuse` now throws on an unknown `evidence.reason` instead of silently falling back to the no-package-json copy. A future refuse branch added without updating the switch will surface as a loud bug rather than a misleading screen.
- The invalid-package-json refuse copy now names the file path and points at the common JSON syntax mistakes (trailing comma, unquoted key, unescaped quote), so a user who is not git-fluent has somewhere to start.
- Recap field labels are lowercase across all three modes (greenfield's existing style), aligning existing-expo and existing-monorepo with prompts.mjs.
- Plan-recap heading renamed from "What I'll add" to "Changes to apply" in existing-expo and existing-monorepo; "We'll add Mobile Surfaces" intro replaced with "Adds Mobile Surfaces". First-person voice is replaced with imperative across the consent moment.
- `--team-id` flag help now names the 10-character length and explains the skip path ("omit to skip and set later in app.json's ios.appleTeamId").
- existing-expo's success screen gains a "When you're ready" section (device run, APNs setup, real-device push) between "Try it now" and "Learn more", matching greenfield and monorepo.
