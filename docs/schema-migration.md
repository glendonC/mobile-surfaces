# Schema Migration

`LiveSurfaceSnapshot` is at `schemaVersion: "1"`. Version `1` introduced the multi-projection contract: a top-level `kind` discriminator and per-kind slices for `widget`, `control`, and `notification`. This page covers what changed, how to migrate stored payloads, how to handle in-flight payloads at the edge, and the policy for future evolution.

## What changed in v1

| Concern | v0 | v1 |
| --- | --- | --- |
| `schemaVersion` | `"0"` | `"1"` |
| Shape | Single object (Live-Activity-shaped) | `z.discriminatedUnion("kind", […])` over six branches |
| `kind` field | Did not exist | Required: `"liveActivity" \| "widget" \| "control" \| "lockAccessory" \| "standby" \| "notification"` |
| Per-kind slices | None | `widget`, `control`, and `notification` branches carry strict slices |
| JSON Schema output | Single object | `oneOf` with `const`-discriminated branches |
| `$id` | `…@0/schema.json` | `https://unpkg.com/@mobile-surfaces/surface-contracts@1.1/schema.json` (major.minor) |

The base fields shared by every v1 branch are identical to the v0 fields (`id`, `surfaceId`, `state`, `modeLabel`, `contextLabel`, `statusLine`, `primaryText`, `secondaryText`, `actionLabel?`, `estimatedSeconds`, `morePartsCount`, `progress`, `stage`, `deepLink`). v0 → v1 promotion is therefore lossless: every v0 payload becomes a v1 `kind: "liveActivity"` snapshot with no slice attached.

## Migrating stored payloads

If you have a database, blob store, or queue holding v0 snapshots, use `migrateV0ToV1` for an explicit promotion:

```ts
import {
  liveSurfaceSnapshotV0,
  migrateV0ToV1,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

function promote(stored: unknown): LiveSurfaceSnapshot {
  const v0 = liveSurfaceSnapshotV0.parse(stored);
  return migrateV0ToV1(v0);
}
```

`migrateV0ToV1` is a pure transform on an already-parsed v0 value. It does not validate the result against the v1 schema (the input has already been validated against v0, and the v1 base shape is a strict superset). If you want belt-and-braces, run `liveSurfaceSnapshot.parse(migrateV0ToV1(v0))`.

## Migrating in-flight payloads

For wire-edge code (HTTP handlers, queue consumers, push receivers) that may see either version, use `safeParseAnyVersion`:

```ts
import { safeParseAnyVersion } from "@mobile-surfaces/surface-contracts";

const result = safeParseAnyVersion(rawBody);
if (!result.success) {
  return reject(result.error); // ZodError from the v1 attempt
}

if (result.deprecationWarning) {
  log.warn(result.deprecationWarning, { snapshotId: result.data.id });
}

handle(result.data); // always v1
```

Behavior:

1. Try the strict v1 discriminated union first.
2. On v1 failure, try v0; on success, promote via `migrateV0ToV1` and attach a `deprecationWarning` string so callers can log telemetry.
3. On both failures, return the v1 `ZodError` (the more informative message for new producers).

The codec is the only blessed migration entry point. Do not write your own `if (payload.schemaVersion === "0")` ladder, since that branch will multiply when v2 lands.

## Missing-`kind` back-compat

Some externally stored snapshots predate the discriminator entirely: they have `schemaVersion: "1"` but no `kind` field, because they were authored against an early v1 shape that defaulted the discriminator. The schema's `.preprocess()` shim handles this:

```ts
// from packages/surface-contracts/src/schema.ts
export const liveSurfaceSnapshot = z.preprocess(
  (value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !("kind" in (value as Record<string, unknown>))
    ) {
      return { ...(value as Record<string, unknown>), kind: "liveActivity" };
    }
    return value;
  },
  z.discriminatedUnion("kind", [/* … */]),
);
```

A snapshot missing `kind` parses as a `liveActivity` branch. Authored fixtures in this repo always set `kind` explicitly, and the projection helpers (`toLiveActivityContentState`, `toWidgetTimelineEntry`, etc.) all narrow on `kind`, so the shim is a one-way back-compat ramp, not a license to omit the field in new code.

## JSON Schema `$id` pinning

`scripts/build-schema.mjs` pins `$id` to **major.minor**:

```text
https://unpkg.com/@mobile-surfaces/surface-contracts@1.1/schema.json
```

Pinning to `1.1` rather than `1` lets a future minor that adds a discriminated-union variant (e.g. a `kind: "interactiveAlert"` branch) publish at `@1.2/schema.json` without invalidating the URL existing consumers reference. Backends that want to track the latest minor automatically can pin to `@1/schema.json` (unpkg resolves the major), but the canonical `$id` stamped into the schema is the major.minor URL.

## Future evolution policy

- **Bump `schemaVersion`** only on a breaking change: renaming or removing a field, changing a type, tightening a constraint (e.g. an enum drops a value, a string gains a regex it did not have before), or anything that makes a previously valid payload fail to parse.
- **Additive optional fields are non-breaking.** Adding a new `actionLabel`-style optional field, or a new `kind` branch with its own optional slice, does not require a bump.
- **A new `kind` value is a minor bump on the published JSON Schema** (new `oneOf` branch, new `$id` at `@1.N/schema.json`). The TypeScript union widens, but no existing payload becomes invalid.
- **When v2 lands**, the migration story extends naturally: add `liveSurfaceSnapshotV1` (frozen at the v2 cutover), `migrateV1ToV2`, and update `safeParseAnyVersion` to chain v0 → v1 → v2. Consumers using the codec do not need to change call sites.

## Standard Schema interop

Zod 4 implements the [Standard Schema](https://standardschema.dev) v1 spec on every exported schema. That means `liveSurfaceSnapshot` is callable from any Standard-Schema-aware library without taking a runtime dependency on Zod:

```ts
import { liveSurfaceSnapshot } from "@mobile-surfaces/surface-contracts";

// Standard Schema's vendor-agnostic interface.
const standard = liveSurfaceSnapshot["~standard"];
// → { vendor: "zod", version: 1, validate, jsonSchema }

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
