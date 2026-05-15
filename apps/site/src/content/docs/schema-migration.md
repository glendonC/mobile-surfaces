---
title: "Schema Migration"
description: "v2 to v3 codec, deprecation timeline, JSON Schema $id, future evolution policy."
order: 80
---
# Schema Migration

`LiveSurfaceSnapshot` is at `schemaVersion: "3"`. Version `3` renamed the control slice's inner `kind` field to `controlKind` to stop shadowing the outer discriminator; every other kind is pass-through with a bumped version literal. The v1 codec was sunset at 4.0 per the v2 RFC commitment; only v2 payloads migrate through `safeParseAnyVersion` now. This page covers what changed at v3, how to migrate stored payloads from v2, how to handle in-flight payloads at the edge, and the policy for future evolution.

## What changed in v3

| Concern | v2 | v3 |
| --- | --- | --- |
| `schemaVersion` | `"2"` | `"3"` |
| Control slice's inner discriminator | `control.kind` (shadowed the outer discriminator) | `control.controlKind` |
| Every other kind | unchanged | unchanged |
| `$id` | `https://unpkg.com/@mobile-surfaces/surface-contracts@3.2/schema.json` | `https://unpkg.com/@mobile-surfaces/surface-contracts@4.0/schema.json` |
| v1 codec | available via `migrateV1ToV2` and `safeParseAnyVersion` | sunset; consumers on v1 must migrate via `@mobile-surfaces/surface-contracts@3` first |

v3's wire-format change is small on purpose. v2 had a control snapshot where `controlSnap.kind === "control"` (outer discriminator) and `controlSnap.control.kind === "toggle"` (inner control-kind). Two different `kind` fields at different paths is a hand-authoring footgun in raw payloads. v3 renames the inner one to `controlKind`. The projection output (`liveSurfaceControlValueProvider`) already exposed the field as `controlKind`, so consumers reading the projected value see no change.

The base fields are unchanged from v2: `id`, `surfaceId`, `updatedAt`, `state`, `modeLabel`, `contextLabel`, `statusLine`, `primaryText`, `secondaryText`, `actionLabel?`, `progress`, `deepLink`. The `liveActivity` kind still carries `{ stage, estimatedSeconds, morePartsCount }`. Every kind other than `control` is pass-through.

## Migrating stored payloads from v2

If you have a database, blob store, or queue holding v2 snapshots, use `migrateV2ToV3` for an explicit promotion:

```ts
import {
  liveSurfaceSnapshotV2,
  migrateV2ToV3,
  liveSurfaceSnapshot,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

function promote(stored: unknown): LiveSurfaceSnapshot {
  const v2 = liveSurfaceSnapshotV2.parse(stored);
  const v3 = migrateV2ToV3(v2);
  // Belt-and-braces: re-parse against the live v3 schema.
  return liveSurfaceSnapshot.parse(v3);
}
```

`migrateV2ToV3` is a pure transform on an already-parsed v2 value. The mapping is mechanical:

- `kind: "control"`: `control.kind` is renamed to `control.controlKind`. `state` and `intent` pass through unchanged.
- Every other `kind`: pass-through. v3 made no other shape changes.
- `schemaVersion` bumps to `"3"`. The outer `kind` is preserved.

## Migrating in-flight payloads

For wire-edge code (HTTP handlers, queue consumers, push receivers) that may see either version, use `safeParseAnyVersion`:

```ts
import { safeParseAnyVersion } from "@mobile-surfaces/surface-contracts";

const result = safeParseAnyVersion(rawBody);
if (!result.success) {
  return reject(result.error); // ZodError from the v3 attempt
}

if (result.deprecationWarning) {
  log.warn(result.deprecationWarning, { snapshotId: result.data.id });
}

handle(result.data); // always v3
```

Behavior:

1. Try the strict v3 discriminated union first.
2. On v3 failure, try v2; on success, promote via `migrateV2ToV3` and attach a `deprecationWarning` string so callers can log telemetry.
3. On both failures, return the v3 `ZodError` (the more informative message for new producers).

The codec is the only blessed migration entry point. Do not write your own `if (payload.schemaVersion === "2")` ladder, since that branch will multiply when v4 lands.

## Deprecation timeline

The v2 codec lives for the entire 4.x major release line.

| Release | Codec state | Producer guidance |
| --- | --- | --- |
| 4.0.0 | v2 codec on. `safeParseAnyVersion` emits a `deprecationWarning` on every v2 parse. | Start migrating producers to v3. |
| 4.x.y | v2 codec on for every release in the 4.x line. Same warning. | Migrate at any point during 4.x. |
| 5.0.0 | v2 codec removed. v2 payloads fail with a v3 `ZodError`. | Must be on v3 before bumping past 4.x. |

The cost of carrying the codec for an entire major (one frozen Zod schema, one pure transform, one branch in `safeParseAnyVersion`) is roughly 150 lines. The benefit is that downstream installs pinned to `^4.0.0` keep parsing v2 payloads through every 4.x minor without any required producer-side change.

## v1 is no longer supported

The v1 codec was sunset at the 4.0.0 cutover, per the original v2 RFC commitment ("v1 codec stays on for the entire 3.x line, removed in 4.0.0"). If you have v1 payloads at rest, pin `@mobile-surfaces/surface-contracts@3.x` to access `migrateV1ToV2`, run the migration once, store the v2 result, then upgrade to 4.x and let `safeParseAnyVersion` promote v2 -> v3.

v0 was a single-object pre-discriminator shape that never shipped publicly; v0 support was removed in 3.0.0.

## Schema Version vs Package Version

`schemaVersion` is the wire-format version inside every snapshot. npm package versions are release versions for the package that ships the validator, helpers, TypeScript types, and JSON Schema.

The package can publish many releases while `schemaVersion` stays `"3"`. Only a breaking wire-format change bumps `schemaVersion`.

## JSON Schema `$id` Pinning

`scripts/build-schema.mjs` pins `$id` to the current package **major.minor**:

```text
https://unpkg.com/@mobile-surfaces/surface-contracts@4.0/schema.json
```

Pinning to `4.0` rather than `4` lets a future minor that adds a discriminated-union variant publish at `@4.1/schema.json` without invalidating the URL existing consumers reference. Backends that want to track the latest minor automatically can pin to `@4/schema.json` (unpkg resolves the major), but the canonical `$id` stamped into the schema is the major.minor URL. Older URLs (`@3.2/schema.json`, `@3.0/schema.json`) stay resolvable forever; unpkg never deletes a published artifact.

## Future evolution policy

- **Bump `schemaVersion`** only on a breaking change: renaming or removing a field, changing a type, tightening a constraint (e.g. an enum drops a value, a string gains a regex it did not have before), or anything that makes a previously valid payload fail to parse.
- **Additive optional fields are non-breaking.** Adding a new `actionLabel`-style optional field, or a new `kind` branch with its own optional slice, does not require a bump.
- **A new `kind` value is a minor bump on the published JSON Schema** (new `oneOf` branch, new `$id` at `@3.N/schema.json`). The TypeScript union widens, but no existing payload becomes invalid.
- **When v4 lands**, the migration story extends naturally: add `liveSurfaceSnapshotV3` (frozen at the v4 cutover), `migrateV3ToV4`, and update `safeParseAnyVersion` to chain v4 -> v3. Consumers using the codec do not need to change call sites; the v2 codec ages out at the 5.0 boundary regardless of when v4 lands.

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
