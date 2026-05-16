---
title: "Versioning Charter"
description: "Linked release group, independent packages, deprecation timeline, schemaVersion policy."
order: 75
group: "Reference"
---

# Versioning Charter

This page is the policy that decides when each Mobile Surfaces package cuts a major, when it cuts a minor, and what consumers can rely on across upgrades. The CI gates that enforce the charter (MS041, MS042, MS043) are listed inline.

## Linked release group

Three packages cut majors together:

- `@mobile-surfaces/surface-contracts`
- `@mobile-surfaces/validators`
- `@mobile-surfaces/traps`

These three share one wire-format contract and one trap catalog. A breaking change to the snapshot schema or to a trap binding moves all three majors in lockstep. Their internal dependencies use `workspace:*` (exact pin) because they ship together; a downstream consumer pins one and gets a matching set.

This is the only linked group. The configuration lives in `.changeset/config.json`:

```json
{
  "linked": [
    [
      "@mobile-surfaces/surface-contracts",
      "@mobile-surfaces/validators",
      "@mobile-surfaces/traps"
    ]
  ]
}
```

## Independent packages

Four packages version independently:

- `@mobile-surfaces/push`
- `@mobile-surfaces/live-activity`
- `@mobile-surfaces/tokens`
- `create-mobile-surfaces`

Each cuts a major only when its own API surface changes. Its dependency on a linked-group package is declared as `workspace:^` so the published artifact carries a caret range; a downstream consumer can upgrade the linked group within a major without forcing an independent-package bump.

A linked-group major still cascades to every independent package as at least a minor bump (consumers pulling the new types). The CHANGELOG entry for that release should call out the linked-group reason explicitly:

```markdown
## 6.0.0

- Linked-group bump for the v5 schema release in `@mobile-surfaces/surface-contracts`. No SDK API change.
```

## What constitutes a major

A breaking change is one a typed consumer could detect at the type-system boundary or one a runtime consumer could detect at the parse boundary. Specifically:

- Removing or renaming a published export.
- Narrowing a type's input (a required field becomes optional is additive; an optional field becomes required is breaking).
- Changing a function's return type to a non-superset.
- Changing the wire-format `schemaVersion` literal.
- Removing a deprecated codec from `safeParseAnyVersion`.
- Removing a trap id from the catalog.

A non-breaking change is one a consumer can absorb by upgrading the lockfile. New exports, new optional fields, new trap ids, new error subclasses (additive), new diagnostic detail in an existing error — all minor.

## schemaVersion policy

`@mobile-surfaces/surface-contracts` ships a `schemaVersion` literal at `liveSurfaceSnapshotBaseShape`. The current value is read from that source. Every projection-output schema (`liveSurfaceWidgetTimelineEntry`, `liveSurfaceControlValueProvider`, `liveSurfaceLockAccessoryEntry`, `liveSurfaceStandbyEntry`, `liveSurfaceNotificationContentEntry`, `liveSurfaceNotificationContentPayload`) mirrors the same literal as its first property.

The first-property ordering is load-bearing. The on-device Codable mirror reads `{ schemaVersion: String }` before attempting full Codable decode. A widget binary on schemaVersion N that reads a host snapshot at schemaVersion N+1 detects the mismatch up front and renders a version-mismatch placeholder instead of failing silently against an incompatible struct shape. The gate is MS041 (`scripts/check-projection-envelope-version.mjs`).

A `schemaVersion` bump always moves the linked group's major. The frozen codec for the previous version ships as `schema-v<N-1>.ts` and is exercised by `safeParseAnyVersion` as a fallback path. Producers running on the old generation get a `deprecationWarning` from the codec; the warning carries the migration target.

## Deprecation timeline

A deprecated codec lives for at least one major past the release that deprecated it. The minimum window is one full major; the typical window is two.

- A codec deprecated in `surface-contracts@6` is removable in `@8` at the earliest.
- A codec deprecated in `surface-contracts@5` is removable in `@7` at the earliest.

The actual schedule sits inline with the codec source (`schema-v3.ts`, `schema-v4.ts`) and in the deprecation warning string the codec emits. The MS042 gate (`scripts/check-deprecation-prose.mjs`) catches the case where the prose says "will be removed in X.0.0" but the package has already shipped X.0.0 — that's a charter violation. The fix is to push the deprecation to a future major (charter minimum: one past the current) or to actually drop the codec.

The check is opt-out only via an explicit `// CHARTER: keep` marker on the preceding line. Use sparingly; the marker exists for the rare case where the prose intentionally describes a historical promise.

## CHANGELOG requirement

Every package whose `package.json` declares version `X.0.0` (for `X >= 1`) must have a matching `## X.0.0` heading in its `CHANGELOG.md`. The body is up to the maintainer; the check enforces the heading. The MS043 gate (`scripts/check-changelog-on-major.mjs`) is the belt to the changeset workflow's suspender — it catches the case where a major was hand-bumped or the changeset entry was missed.

For a linked-group bump where the independent package has no API change of its own, the convention is one line:

```markdown
## 6.0.0

- Linked-group bump for the v5 schema release in `@mobile-surfaces/surface-contracts`. No `<package>` API change.
```

## Workspace dependency convention

In source:

- A linked-group member depending on another linked-group member uses `workspace:*` (exact pin). The three packages ship together.
- An independent package depending on a linked-group member uses `workspace:^` (caret range). The published artifact carries a caret range against the linked group.
- An independent package depending on another independent package uses `workspace:^`.

The convention keeps downstream lockfiles upgradeable: a consumer who pulls `@mobile-surfaces/push@7.1` and `@mobile-surfaces/surface-contracts@7.2` gets a working pair because push's caret range against surface-contracts resolves.

## Pre-release behavior

Pre-release tags (`X.0.0-beta.1`, `X.0.0-rc.2`) are an intentional interim state. The MS043 gate matches `X.0.0` exactly and ignores pre-release suffixes; the CHANGELOG entry lands at the final tag.

The `workspace:*` and `workspace:^` conventions still apply during pre-release. A consumer pinning `@mobile-surfaces/surface-contracts@7.0.0-beta.1` accepts the schema may change between beta tags; the final major is the contract.

## Forks and renames

The schema URL (`https://unpkg.com/@mobile-surfaces/surface-contracts@<major.minor>/schema.json`) pins to the upstream package name. A fork that renames the package gets no schema URL because the tarball is not published under the upstream coordinates. See `scripts/lib/schema-url.mjs` for the resolution rule.

## Out of scope (today)

- Backward-compatibility windows beyond two majors. The charter minimum is one major past the deprecation; the typical window is two.
- Automatic codemod migrations for breaking changes. Each major release documents the migration in its CHANGELOG entry.
- Cross-major Swift bridge compatibility. The native module pod and the host app's bundle ship from the same release; a mismatched pair is not a supported configuration.
