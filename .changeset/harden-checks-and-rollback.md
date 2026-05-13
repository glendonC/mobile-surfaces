---
"@mobile-surfaces/surface-contracts": patch
"@mobile-surfaces/design-tokens": patch
"@mobile-surfaces/live-activity": patch
"@mobile-surfaces/push": patch
"@mobile-surfaces/validators": patch
"create-mobile-surfaces": patch
---

Audit follow-up hardening across the check scripts, CLI safety, and push SDK test coverage.

The MS003 `check-activity-attributes` script now parses Swift `CodingKeys` and compares on JSON key rather than the Swift identifier, closing the silent class of failure where a `case headline = "title"` remap stayed byte-identical across both attribute files but broke ActivityKit decode. The parser handles auto-synthesized CodingKeys, raw-value remaps, multi-case declarations, partial enums (properties excluded from CodingKeys are flagged as never-serialized), and CodingKeys declared in a sibling extension.

The `create-mobile-surfaces` add-to-existing apply now snapshots every file or directory it is about to touch and rolls back on any thrown error from the apply phase. A failed `pnpm add` or partial widget rewrite no longer leaves the user with a half-patched project. The backup directory is removed on commit and on rollback regardless of per-entry errors so a rerun starts clean.

Adds subprocess-driven negative tests for `check-adapter-boundary`, `check-activity-attributes`, and `check-app-group-identity` (previously untested), and end-to-end coverage for the push SDK's expired-JWT retry path and broadcast/channel failure modes (`FeatureNotEnabled`, `ChannelNotRegistered`, `BadChannelId`, `CannotCreateChannelConfig`).

No public API surface changed. Internal test seams in `packages/push/src/client.ts` are symbol-keyed (`TEST_TRANSPORT_OVERRIDE`) and cannot be reached from production callers.
