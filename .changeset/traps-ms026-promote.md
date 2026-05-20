---
"@mobile-surfaces/traps": minor
---

Promote MS026 (widget target managed by @bacons/apple-targets) from a warning-only emission to a fail. The check now fires as a build failure when `apps/mobile/targets/widget/` exists but `expo-target.config.js` does not. A project that ships no widget target at all skips the check entirely.

The catalog entry for MS026 gains an `enforcement.script` field pointing at `scripts/probe-app-config.mjs`, so `@mobile-surfaces/traps` consumers reading the binding will now see the script reference where the field was previously absent. The MS026 severity was already `error`; this change brings the gate behavior into line with what the catalog has always claimed.

Background: the spike for refactor-v9 Phase 1e confirmed that every Mobile Surfaces scaffold variant lands `expo-target.config.js` regardless of the home-widget or control-widget toggles, so the file's absence in a starter-shaped project signals a deliberate removal of the config (not the toggling-off of widget surfaces). For foreign Expo projects audited via the catalog, the new conditional means projects without a widget target dir are not penalized.
