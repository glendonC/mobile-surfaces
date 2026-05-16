---
title: "Schema Migration"
description: "v3/v4 codec chain, deprecation timeline, JSON Schema $id, future evolution policy."
order: 80
group: "Build"
---
# Schema Migration

See [Versioning Charter](./stability) for the policy that decides when this changes.

`LiveSurfaceSnapshot` is at `schemaVersion: "5"`. Version 5 is additive on the snapshot wire shape (four new optional fields on the notification slice — `subtitle`, `interruptionLevel`, `relevanceScore`, `targetContentId`) and realigns the projection-output sidecar's discriminator from `"surface_notification"` to `"surface_snapshot"` so on-device routing code can switch on one literal regardless of which Mobile Surfaces wrapper produced the userInfo. `safeParseAnyVersion` chains v5 -> v4 -> v3; the v3 and v4 codecs are removed at 8.0 (see the deprecation timeline below). The v2 codec was sunset at 5.0 per the v3 RFC commitment. This page covers what changed at v5, how to migrate stored payloads from earlier versions, how to handle in-flight payloads at the edge, and the policy for future evolution.

## What changed in v5

| Concern | v4 | v5 |
| --- | --- | --- |
| `schemaVersion` | `"4"` | `"5"` |
| Notification slice | `title`, `body`, `deepLink`, `category?`, `threadId?` | adds optional `subtitle`, `interruptionLevel`, `relevanceScore`, `targetContentId` (all `aps`-mapped, iOS 17.2+) |
| `notification.category` typing | `z.string().optional()` | `z.enum([...NOTIFICATION_CATEGORY_IDS]).optional()` — values come from `packages/surface-contracts/src/notificationCategories.ts`, enforced by MS037 codegen |
| Notification projection sidecar | `kind: "surface_notification"` | `kind: "surface_snapshot"` (aligned with `liveActivityAlertPayload`'s sidecar) |
| `liveSurfaceNotificationContentEntry` | inline anonymous object | hoisted, named, MS036-parity-checked |
| `$id` | `https://unpkg.com/@mobile-surfaces/surface-contracts@5.0/schema.json` | `https://unpkg.com/@mobile-surfaces/surface-contracts@7.0/schema.json` |
| v3 codec | live; retirement deferred to 8.0 per the stability charter | live; retirement deferred to 8.0 per the stability charter (unchanged) |

The breaking change v5 carries lives in the projection-output sidecar, not the snapshot. A v4 snapshot promotes to v5 by bumping the literal; no field renames, no slice restructure. Producers that hand-wrote APNs envelopes against `kind: "surface_notification"` will need to update; everyone projecting through `toNotificationContentPayload` gets the new shape for free.

## What changed in v4 (historical)

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

Both the v3 and v4 codecs are scheduled for retirement at 8.0. The original v3 RFC named 6.0 as the v3 sunset; the stability charter (see [`stability`](/docs/stability) when it lands) supersedes that with a single rule: a codec gets at least one full major between deprecation announcement and removal. v3 was first announced as deprecated at 5.0, so the earliest retirement is 7.0; carrying both v3 and v4 through one more major lines them up at 8.0.

| Release | Codec state | Producer guidance |
| --- | --- | --- |
| 5.0.0 | v3 codec on. `safeParseAnyVersion` emits a `deprecationWarning` on every v3 parse. | Start migrating producers to v4. |
| 6.0.0 | v5 schema cuts over. v4 codec joins v3 with a `deprecationWarning`. Both remain on. | Start migrating producers to v5. |
| 7.0.0 | v3 and v4 codecs remain on with `deprecationWarning`. Final warning major. | Producers still on v3 or v4 must migrate before 8.0. |
| 8.0.0 | v3 and v4 codecs removed. v3 / v4 payloads fail with a v5 `ZodError`. | Must be on v5 before bumping past 7.x. |

The cost of carrying a codec for an entire major (one frozen Zod schema, one pure transform, one branch in `safeParseAnyVersion`) is roughly 200 lines per version. The benefit is that downstream installs pinned to `^N.0.0` keep parsing older payloads through every N.x minor without any required producer-side change.

## v2 is no longer supported

The v2 codec was sunset at the 5.0.0 cutover, per the original v3 RFC commitment ("v2 codec stays on for the entire 4.x line, removed in 5.0.0"). If you have v2 payloads at rest, pin `@mobile-surfaces/surface-contracts@4.x` to access `migrateV2ToV3`, run the migration once, store the v3 result, then upgrade to 5.x and let `safeParseAnyVersion` promote v3 -> v4.

v1 and v0 are also no longer reachable from the current package; promote stored payloads through the matching older major (`@3` for v1 -> v2, `@4` for v2 -> v3) before upgrading to 5.x.

## Schema Version vs Package Version

`schemaVersion` is the wire-format version inside every snapshot. npm package versions are release versions for the package that ships the validator, helpers, TypeScript types, and JSON Schema.

The package can publish many releases while `schemaVersion` stays `"4"`. Only a breaking wire-format change bumps `schemaVersion`.

## JSON Schema `$id` Pinning

`scripts/build-schema.mjs` pins `$id` to the current package **major.minor**:

```text
https://unpkg.com/@mobile-surfaces/surface-contracts@7.0/schema.json
```

Pinning to `7.0` rather than `7` lets a future minor that adds a discriminated-union variant publish at `@7.1/schema.json` without invalidating the URL existing consumers reference. Backends that want to track the latest minor automatically can pin to `@7/schema.json` (unpkg resolves the major), but the canonical `$id` stamped into the schema is the major.minor URL. Older URLs (`@6.0/schema.json`, `@5.0/schema.json`, `@4.0/schema.json`, `@3.0/schema.json`) stay resolvable forever; unpkg never deletes a published artifact.

The URL channel is keyed off the package major; the wire-format `schemaVersion` lags by one (package 7.x ships `schemaVersion: "5"`, package 6.x shipped the same). This is self-consistent and intentional: a coordinated linked-group bump can be driven by changes elsewhere in the family without forcing a wire-format major.

## Future evolution policy

- **Bump `schemaVersion`** only on a breaking change: renaming or removing a field, changing a type, tightening a constraint (e.g. an enum drops a value, a string gains a regex it did not have before), or anything that makes a previously valid payload fail to parse.
- **Additive optional fields are non-breaking.** Adding a new `actionLabel`-style optional field, or a new `kind` branch with its own optional slice, does not require a bump.
- **A new `kind` value is a minor bump on the published JSON Schema** (new `oneOf` branch, new `$id` at `@5.N/schema.json`). The TypeScript union widens, but no existing payload becomes invalid.
- **When v6 lands**, the migration story extends naturally: add `liveSurfaceSnapshotV5` (frozen at the v6 cutover), `migrateV5ToV6`, and update `safeParseAnyVersion` to chain v5 -> v6. Consumers using the codec do not need to change call sites; the v3 and v4 codecs age out at the 8.0 boundary regardless of when v6 lands.

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
