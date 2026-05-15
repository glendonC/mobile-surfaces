---
title: "Schema Migration"
description: "v3 to v4 codec, deprecation timeline, JSON Schema $id, future evolution policy."
order: 80
group: "Build"
---
# Schema Migration

`LiveSurfaceSnapshot` is at `schemaVersion: "4"`. Version `4` collapses the base shape to identity-only (`id`, `surfaceId`, `kind`, `updatedAt`, `state`) and moves every rendering field into the per-kind slice that uses it. The notification slice renames `primaryText`/`secondaryText` to `title`/`body` to match the APNs alert shape it projects into; the control slice gains a required `label`. The v2 codec was sunset at 5.0 per the v3 RFC commitment; only v3 payloads migrate through `safeParseAnyVersion` now. This page covers what changed at v4, how to migrate stored payloads from v3, how to handle in-flight payloads at the edge, and the policy for future evolution.

## What changed in v4

| Concern | v3 | v4 |
| --- | --- | --- |
| `schemaVersion` | `"3"` | `"4"` |
| Base shape | id, surfaceId, kind, updatedAt, state, modeLabel, contextLabel, statusLine, primaryText, secondaryText, actionLabel?, progress, deepLink | id, surfaceId, kind, updatedAt, state (rendering fields moved into per-kind slices) |
| Notification slice | inherited `primaryText`/`secondaryText` from base | own `title`/`body` fields (matches APNs `aps.alert` shape) |
| Control slice | optional `intent`/`state`; label fell back to base `primaryText` | required `label`; explicit `controlKind`, optional `state`/`intent` |
| `$id` | `https://unpkg.com/@mobile-surfaces/surface-contracts@4.0/schema.json` | `https://unpkg.com/@mobile-surfaces/surface-contracts@5.0/schema.json` |
| v2 codec | available via `migrateV2ToV3` and `safeParseAnyVersion` in 4.x | sunset at 5.0; consumers on v2 must migrate via `@mobile-surfaces/surface-contracts@4` first |

v4's wire-format change finishes the slice-per-kind transition v3 (3.0) started. v3 only moved liveActivity-specific timing hints (`stage`, `estimatedSeconds`, `morePartsCount`) off the base. Everything else (`modeLabel`, `contextLabel`, `statusLine`, `primaryText`, `secondaryText`, `actionLabel`, `progress`, `deepLink`) still rode on the base, even for surfaces that did not render them. v4 pushes each rendering field into the slice for the kind that actually uses it, so the base ends up as pure identity + lifecycle. The projection helpers (`toLiveActivityContentState`, `toWidgetTimelineEntry`, `toControlValueProvider`, `toNotificationContentPayload`, `toLockAccessoryEntry`, `toStandbyEntry`) take a strictly-typed per-kind snapshot and project to their existing consumer shapes.

## Migrating stored payloads from v3

If you have a database, blob store, or queue holding v3 snapshots, use `migrateV3ToV4` for an explicit promotion:

```ts
import {
  liveSurfaceSnapshotV3,
  migrateV3ToV4,
  liveSurfaceSnapshot,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

function promote(stored: unknown): LiveSurfaceSnapshot {
  const v3 = liveSurfaceSnapshotV3.parse(stored);
  const v4 = migrateV3ToV4(v3);
  // Belt-and-braces: re-parse against the live v4 schema.
  return liveSurfaceSnapshot.parse(v4);
}
```

`migrateV3ToV4` is a pure transform on an already-parsed v3 value. The mapping is mechanical:

- `kind: "liveActivity"`: the slice gains `title`/`body` (from base `primaryText`/`secondaryText`), `progress`, `deepLink`, `modeLabel`, `contextLabel`, `statusLine`, and `actionLabel?` from the base. `stage`, `estimatedSeconds`, `morePartsCount` are preserved.
- `kind: "widget"`: the slice gains `title`/`body` (from base), `progress`, and `deepLink`. `family?`, `reloadPolicy?` pass through.
- `kind: "control"`: the slice gains a required `label` (from v3's `actionLabel`, falling back to `primaryText`) and `deepLink`. `controlKind`, `state?`, `intent?` pass through.
- `kind: "notification"`: the slice gains `title`/`body` (renamed from base `primaryText`/`secondaryText`) and `deepLink`. `category?`, `threadId?` pass through.
- `kind: "lockAccessory"`: the slice gains `title` (from base `primaryText`) and `deepLink`. `family`, `gaugeValue?`, `shortText?` pass through.
- `kind: "standby"`: the slice gains `title`/`body` (from base), `progress`, and `deepLink`. `presentation`, `tint?` pass through.
- The base shape narrows to identity + lifecycle: `id`, `surfaceId`, `kind`, `updatedAt`, `state`.
- `schemaVersion` bumps to `"4"`. The outer `kind` is preserved.

## Migrating in-flight payloads

For wire-edge code (HTTP handlers, queue consumers, push receivers) that may see either version, use `safeParseAnyVersion`:

```ts
import { safeParseAnyVersion } from "@mobile-surfaces/surface-contracts";

const result = safeParseAnyVersion(rawBody);
if (!result.success) {
  return reject(result.error); // ZodError from the v4 attempt
}

if (result.deprecationWarning) {
  log.warn(result.deprecationWarning, { snapshotId: result.data.id });
}

handle(result.data); // always v4
```

Behavior:

1. Try the strict v4 discriminated union first.
2. On v4 failure, try v3; on success, promote via `migrateV3ToV4` and attach a `deprecationWarning` string so callers can log telemetry.
3. On both failures, return the v4 `ZodError` (the more informative message for new producers).

The codec is the only blessed migration entry point. Do not write your own `if (payload.schemaVersion === "3")` ladder, since that branch will multiply when v5 lands.

## Deprecation timeline

The v3 codec lives for the entire 5.x major release line.

| Release | Codec state | Producer guidance |
| --- | --- | --- |
| 5.0.0 | v3 codec on. `safeParseAnyVersion` emits a `deprecationWarning` on every v3 parse. | Start migrating producers to v4. |
| 5.x.y | v3 codec on for every release in the 5.x line. Same warning. | Migrate at any point during 5.x. |
| 6.0.0 | v3 codec removed. v3 payloads fail with a v4 `ZodError`. | Must be on v4 before bumping past 5.x. |

The cost of carrying the codec for an entire major (one frozen Zod schema, one pure transform, one branch in `safeParseAnyVersion`) is roughly 200 lines. The benefit is that downstream installs pinned to `^5.0.0` keep parsing v3 payloads through every 5.x minor without any required producer-side change.

## v2 is no longer supported

The v2 codec was sunset at the 5.0.0 cutover, per the original v3 RFC commitment ("v2 codec stays on for the entire 4.x line, removed in 5.0.0"). If you have v2 payloads at rest, pin `@mobile-surfaces/surface-contracts@4.x` to access `migrateV2ToV3`, run the migration once, store the v3 result, then upgrade to 5.x and let `safeParseAnyVersion` promote v3 -> v4.

v1 and v0 are also no longer reachable from the current package; promote stored payloads through the matching older major (`@3` for v1 -> v2, `@4` for v2 -> v3) before upgrading to 5.x.

## Schema Version vs Package Version

`schemaVersion` is the wire-format version inside every snapshot. npm package versions are release versions for the package that ships the validator, helpers, TypeScript types, and JSON Schema.

The package can publish many releases while `schemaVersion` stays `"4"`. Only a breaking wire-format change bumps `schemaVersion`.

## JSON Schema `$id` Pinning

`scripts/build-schema.mjs` pins `$id` to the current package **major.minor**:

```text
https://unpkg.com/@mobile-surfaces/surface-contracts@5.0/schema.json
```

Pinning to `5.0` rather than `5` lets a future minor that adds a discriminated-union variant publish at `@5.1/schema.json` without invalidating the URL existing consumers reference. Backends that want to track the latest minor automatically can pin to `@5/schema.json` (unpkg resolves the major), but the canonical `$id` stamped into the schema is the major.minor URL. Older URLs (`@4.0/schema.json`, `@3.2/schema.json`, `@3.0/schema.json`) stay resolvable forever; unpkg never deletes a published artifact.

## Future evolution policy

- **Bump `schemaVersion`** only on a breaking change: renaming or removing a field, changing a type, tightening a constraint (e.g. an enum drops a value, a string gains a regex it did not have before), or anything that makes a previously valid payload fail to parse.
- **Additive optional fields are non-breaking.** Adding a new `actionLabel`-style optional field, or a new `kind` branch with its own optional slice, does not require a bump.
- **A new `kind` value is a minor bump on the published JSON Schema** (new `oneOf` branch, new `$id` at `@5.N/schema.json`). The TypeScript union widens, but no existing payload becomes invalid.
- **When v5 lands**, the migration story extends naturally: add `liveSurfaceSnapshotV4` (frozen at the v5 cutover), `migrateV4ToV5`, and update `safeParseAnyVersion` to chain v5 -> v4. Consumers using the codec do not need to change call sites; the v3 codec ages out at the 6.0 boundary regardless of when v5 lands.

## Standard Schema interop

Zod 4 implements the [Standard Schema](https://standardschema.dev) v1 spec on every exported schema. That means `liveSurfaceSnapshot` is callable from any Standard-Schema-aware library without taking a runtime dependency on Zod:

```ts
import { liveSurfaceSnapshot } from "@mobile-surfaces/surface-contracts";

// Standard Schema's vendor-agnostic interface.
const standard = liveSurfaceSnapshot["~standard"];
// -> { vendor: "zod", version: 1, validate, jsonSchema }

// Example: a Valibot-style consumer that only knows Standard Schema.
function validate<T>(
  schema: { "~standard": { validate: (v: unknown) => { value?: T; issues?: readonly unknown[] } } },
  value: unknown,
): T {
  const result = schema["~standard"].validate(value);
  if (result.issues) {
    throw new Error(`Validation failed: ${JSON.stringify(result.issues)}`);
  }
  return result.value as T;
}

const snapshot = validate(liveSurfaceSnapshot, await request.json());
```

The same call works for any consumer that speaks Standard Schema: Valibot's `safeParse`, ArkType's `~standard` interop, `@standard-schema/spec` runners, etc. Backends that prefer Valibot or ArkType internally can still validate Mobile Surfaces payloads against the canonical Zod-defined contract; they just consume the `~standard` surface instead of importing `zod`.

A live assertion in the package's test suite pins this behavior. Do not remove it, since Standard Schema is the public boundary the contract commits to.
