---
title: "Schema Migration"
description: "v1 to v2 codec, deprecation timeline, JSON Schema $id, future evolution policy."
order: 80
---
# Schema Migration

`LiveSurfaceSnapshot` is at `schemaVersion: "2"`. Version `2` moved liveActivity-only timing and stage hints out of the base shape, promoted `updatedAt` to required, and tightened the discriminated union to require an explicit `kind`. This page covers what changed, how to migrate stored payloads from v1, how to handle in-flight payloads at the edge, and the policy for future evolution.

## What changed in v2

| Concern | v1 | v2 |
| --- | --- | --- |
| `schemaVersion` | `"1"` | `"2"` |
| `stage`, `estimatedSeconds`, `morePartsCount` | Required on every kind (base shape) | Required on `liveActivity` only; carried inside the new `liveActivity` slice |
| `updatedAt` | Optional | Required |
| Missing-`kind` preprocess | Defaulted bare snapshots to `liveActivity` | Removed; `kind` must be set explicitly |
| `liveSurfaceAlertPayload` / `toAlertPayload` | Exported from `@mobile-surfaces/surface-contracts` | Renamed and moved to `@mobile-surfaces/push` as `liveActivityAlertPayload` / `liveActivityAlertPayloadFromSnapshot` |
| `$id` | `https://unpkg.com/@mobile-surfaces/surface-contracts@2.1/schema.json` | `https://unpkg.com/@mobile-surfaces/surface-contracts@3.0/schema.json` |

The base fields shared by every v2 branch are `id`, `surfaceId`, `updatedAt`, `state`, `modeLabel`, `contextLabel`, `statusLine`, `primaryText`, `secondaryText`, `actionLabel?`, `progress`, and `deepLink`. The `liveActivity` kind carries an additional slice `{ stage, estimatedSeconds, morePartsCount }`. Every other kind carries the slice it had in v1 (`widget`, `control`, `notification`, `lockAccessory`, `standby`).

The four changes that motivated the bump are documented in `notes/v2-schema-rfc.md` (development-time only). At a glance:

- **Base-shape correctness.** v1 forced control and widget fixtures to carry meaningless `stage: "inProgress"` and `morePartsCount: 0` filler. v2 puts those fields where they have semantics.
- **Ordering.** v1 made `updatedAt` optional; consumers cannot drop out-of-order pushes on a field producers may not set. v2 requires it.
- **Package boundary.** `liveSurfaceAlertPayload` is an APNs envelope shape. It belongs in `@mobile-surfaces/push` next to the SDK that sends it, not in the contract package.
- **Explicit discriminator.** The v1 missing-`kind` preprocess was a back-compat shim for a v0 that was never published. v2 drops it.

## Migrating stored payloads from v1

If you have a database, blob store, or queue holding v1 snapshots, use `migrateV1ToV2` for an explicit promotion:

```ts
import {
  liveSurfaceSnapshotV1,
  migrateV1ToV2,
  liveSurfaceSnapshot,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

function promote(stored: unknown): LiveSurfaceSnapshot {
  const v1 = liveSurfaceSnapshotV1.parse(stored);
  const v2Like = migrateV1ToV2(v1);
  // v2 requires updatedAt. migrateV1ToV2 does not synthesize one because
  // a "now" timestamp on an old stored payload silently breaks ordering.
  // Belt-and-braces: re-parse against the live v2 schema.
  return liveSurfaceSnapshot.parse(v2Like);
}
```

`migrateV1ToV2` is a pure transform on an already-parsed v1 value. The mapping is mechanical:

- `kind: "liveActivity"`: `stage`, `estimatedSeconds`, and `morePartsCount` move out of the base and under the new `liveActivity` slice. Everything else passes through.
- Every other `kind`: the three liveActivity-only fields are dropped (they had no semantics on those kinds in v1 either; v1 just required them on every branch).
- `schemaVersion` bumps to `"2"`. `kind` is preserved.
- `updatedAt`: if present in v1, passes through; if absent, the result is left with `updatedAt: undefined`, which fails v2 parse on the explicit re-parse step.

If the caller knows it is safe to fill `updatedAt` for legacy records (e.g. backfill jobs migrating a snapshot store), use the opt-in fallback:

```ts
const v2 = migrateV1ToV2(v1, {
  updatedAtFallback: storedAtTimestamp ?? new Date().toISOString(),
});
```

The default is to fail loudly because synthesizing "now" for a snapshot stored an hour ago breaks the very ordering semantic that `updatedAt` exists to provide.

## Migrating in-flight payloads

For wire-edge code (HTTP handlers, queue consumers, push receivers) that may see either version, use `safeParseAnyVersion`:

```ts
import { safeParseAnyVersion } from "@mobile-surfaces/surface-contracts";

const result = safeParseAnyVersion(rawBody);
if (!result.success) {
  return reject(result.error); // ZodError from the v2 attempt
}

if (result.deprecationWarning) {
  log.warn(result.deprecationWarning, { snapshotId: result.data.id });
}

handle(result.data); // always v2
```

Behavior:

1. Try the strict v2 discriminated union first.
2. On v2 failure, try v1; on success, promote via `migrateV1ToV2` and attach a `deprecationWarning` string so callers can log telemetry.
3. On both failures, return the v2 `ZodError` (the more informative message for new producers).

A v1 payload that lacks `updatedAt` (legal in v1) still fails on the codec path because `safeParseAnyVersion` does not synthesize `updatedAt`. The downstream error tells callers exactly which field is missing. The opt-in `updatedAtFallback` is only available through direct `migrateV1ToV2` calls; the wire-edge convenience wrapper stays strict.

The codec is the only blessed migration entry point. Do not write your own `if (payload.schemaVersion === "1")` ladder, since that branch will multiply when v3 lands.

## Deprecation timeline

The v1 codec lives for the entire 3.x major release line.

| Release | Codec state | Producer guidance |
| --- | --- | --- |
| 3.0.0 | v1 codec on. `safeParseAnyVersion` emits a `deprecationWarning` on every v1 parse. | Start migrating producers to v2. |
| 3.x.y | v1 codec on for every release in the 3.x line. Same warning. | Migrate at any point during 3.x. |
| 4.0.0 | v1 codec removed. v1 payloads fail with a v2 `ZodError`. | Must be on v2 before bumping past 3.x. |

The cost of carrying the codec for an entire major (one frozen Zod schema, one pure transform, one branch in `safeParseAnyVersion`) is roughly 200 lines. The benefit is that downstream installs pinned to `^3.0.0` keep parsing v1 payloads through every 3.x minor without any required producer-side change. Removing the codec on a minor would violate the "no breaking changes on a minor" rule the linked-group release cadence advertises.

## v0 is no longer supported

v0 was a single-object pre-discriminator shape that never shipped publicly; the codec was reconstructed from a single internal commit during the v1 release. v0 support was carried through the v1 release line, then removed in 3.0.0 because no external consumer ever held v0 payloads at rest.

If you have a v0 payload somewhere unexpectedly (it should not happen, but the file is here for completeness), pin `@mobile-surfaces/surface-contracts@2.x` to access `migrateV0ToV1`, run the migration once, store the v1 result, then upgrade to 3.x.

## Schema Version vs Package Version

`schemaVersion` is the wire-format version inside every snapshot. npm package versions are release versions for the package that ships the validator, helpers, TypeScript types, and JSON Schema.

The package can publish many releases while `schemaVersion` stays `"2"`. Only a breaking wire-format change bumps `schemaVersion`.

## JSON Schema `$id` Pinning

`scripts/build-schema.mjs` pins `$id` to the current package **major.minor**:

```text
https://unpkg.com/@mobile-surfaces/surface-contracts@3.0/schema.json
```

Pinning to `3.0` rather than `3` lets a future minor that adds a discriminated-union variant publish at `@3.1/schema.json` without invalidating the URL existing consumers reference. Backends that want to track the latest minor automatically can pin to `@3/schema.json` (unpkg resolves the major), but the canonical `$id` stamped into the schema is the major.minor URL. Older URLs (`@2.1/schema.json`, `@2.0/schema.json`) stay resolvable forever; unpkg never deletes a published artifact.

## Future evolution policy

- **Bump `schemaVersion`** only on a breaking change: renaming or removing a field, changing a type, tightening a constraint (e.g. an enum drops a value, a string gains a regex it did not have before), or anything that makes a previously valid payload fail to parse.
- **Additive optional fields are non-breaking.** Adding a new `actionLabel`-style optional field, or a new `kind` branch with its own optional slice, does not require a bump.
- **A new `kind` value is a minor bump on the published JSON Schema** (new `oneOf` branch, new `$id` at `@3.N/schema.json`). The TypeScript union widens, but no existing payload becomes invalid.
- **When v3 lands**, the migration story extends naturally: add `liveSurfaceSnapshotV2` (frozen at the v3 cutover), `migrateV2ToV3`, and update `safeParseAnyVersion` to chain v3 -> v2. Consumers using the codec do not need to change call sites; the v1 codec ages out at the 4.0 boundary regardless of when v3 lands.

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
