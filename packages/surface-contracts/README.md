# @mobile-surfaces/surface-contracts

The wire format for iOS Live Activity payloads. Works with any bridge ([`expo-live-activity`](https://github.com/software-mansion-labs/expo-live-activity), `@mobile-surfaces/live-activity`, or a hand-rolled native module), validates at the backend boundary, ships JSON Schema for non-TS validators and LLM tool use, and exposes [Standard Schema](https://standardschema.dev) so consumers can drop the Zod runtime dependency entirely.

This package is the contract. It does not depend on any iOS bridge, harness app, or push library. Pair it with whichever bridge and APNs library you already use.

## Install

```bash
pnpm add @mobile-surfaces/surface-contracts
```

Requires Node 18+. The single runtime dependency is [Zod](https://zod.dev) v4.

## Quick example: backend service → APNs

A typical Node service maps a domain event to a `LiveSurfaceSnapshot`, validates it, projects it through a `kind`-gated helper, and hands the result to whichever APNs library you already use:

```ts
import {
  assertSnapshot,
  toLiveActivityContentState,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

function snapshotFromJob(job: Job): LiveSurfaceSnapshot {
  return {
    schemaVersion: "4",
    kind: "liveActivity",
    id: `${job.id}@${job.revision}`,
    surfaceId: `job-${job.id}`,
    updatedAt: new Date().toISOString(),
    state: job.status === "done" ? "completed" : "active",
    liveActivity: {
      title: job.title,
      body: job.subtitle ?? "",
      progress: job.progress,
      deepLink: `myapp://surface/job-${job.id}`,
      modeLabel: "active",
      contextLabel: job.queueName,
      statusLine: `${job.queueName} · ${Math.round(job.progress * 100)}%`,
      stage: job.status === "done" ? "completing" : "inProgress",
      estimatedSeconds: job.etaSeconds ?? 0,
      morePartsCount: 0,
    },
  };
}

const snapshot = assertSnapshot(snapshotFromJob(job));      // throws on invalid input
const contentState = toLiveActivityContentState(snapshot);  // → { headline, subhead, progress, stage }

// Hand the projected content state to whichever APNs library you use:
await yourApnsClient.send({
  topic: `${bundleId}.push-type.liveactivity`,
  pushType: "liveactivity",
  payload: {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: "update",
      "content-state": contentState,
    },
  },
});
```

The validator runs once at the boundary; everything downstream consumes a typed `LiveSurfaceSnapshot`.

## The discriminated union

`liveSurfaceSnapshot` is a discriminated union: `kind` picks which branch is valid, and the validator rejects fields that belong to the wrong branch. It covers six branches at `schemaVersion: "4"`:

| `kind` | Renders as | Slice (required fields in **bold**) |
| --- | --- | --- |
| `liveActivity` | Lock Screen Live Activity, Dynamic Island | `liveActivity: { `**`title, body, progress, deepLink, modeLabel, contextLabel, statusLine, stage, estimatedSeconds, morePartsCount`**`, actionLabel? }` |
| `widget` | Home-screen widget | `widget: { `**`title, body, progress, deepLink`**`, family?, reloadPolicy? }` |
| `control` | iOS 18 control widget | `control: { `**`label, deepLink, controlKind`**`, state?, intent? }` |
| `notification` | Notification content | `notification: { `**`title, body, deepLink`**`, category?, threadId? }` |
| `lockAccessory` | Lock Screen complication | `lockAccessory: { `**`title, deepLink, family`**`, gaugeValue?, shortText? }` |
| `standby` | StandBy mode widget | `standby: { `**`title, body, progress, deepLink, presentation`**`, tint? }` |

The base shape is identification + state only: `schemaVersion`, `id`, `surfaceId`, `kind`, `updatedAt`, `state`. Every rendering field lives inside its per-kind slice so a widget snapshot no longer pretends to have a Lock-Screen `modeLabel`, a control snapshot no longer carries a fictional `progress`, and the `notification` slice's `title`/`body` map directly to `aps.alert.title`/`aps.alert.body` (renamed from v3's `primaryText`/`secondaryText`).

`kind`-aware narrowing is enforced at parse time (a `kind: "control"` snapshot without a `control` slice fails `safeParse`) and at the type system (projection helpers take narrowed snapshot types, not the union):

```ts
import {
  assertSnapshot,
  toWidgetTimelineEntry,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

const snapshot = assertSnapshot(input);

if (snapshot.kind === "widget") {
  // TS narrows: snapshot is LiveSurfaceSnapshotWidget; toWidgetTimelineEntry
  // accepts only that narrowed type, so there is no runtime check.
  const entry = toWidgetTimelineEntry(snapshot);
  writeAppGroupEntry(entry);
}
```

Projection helpers exported today: `toLiveActivityContentState`, `toWidgetTimelineEntry`, `toControlValueProvider`, `toNotificationContentPayload`, `toLockAccessoryEntry`, `toStandbyEntry`. The APNs alert-payload helper lives in [`@mobile-surfaces/push`](https://www.npmjs.com/package/@mobile-surfaces/push) (`toApnsAlertPayload` in 5.0+; the `aps` envelope is wire format, not a contract concern). See [`https://mobile-surfaces.com/docs/multi-surface`](https://mobile-surfaces.com/docs/multi-surface) for what each helper returns and when to emit each `kind`.

## Standard Schema interop

Zod 4 implements [Standard Schema](https://standardschema.dev) v1 on every exported schema, so consumers can validate against `liveSurfaceSnapshot` without taking a runtime dependency on Zod:

```ts
import { liveSurfaceSnapshot } from "@mobile-surfaces/surface-contracts";

const result = liveSurfaceSnapshot["~standard"].validate(input);
if (result.issues) {
  throw new Error(`Invalid snapshot: ${JSON.stringify(result.issues)}`);
}
const snapshot = result.value; // typed LiveSurfaceSnapshot
```

The same `~standard` surface is consumable from Valibot, ArkType, `@standard-schema/spec` runners, any library that speaks Standard Schema. A live assertion in this package's test suite pins this behavior, so the interop is a public boundary, not an accident.

## JSON Schema

Backends that aren't on TypeScript can validate against the published JSON Schema, which is generated by `z.toJSONSchema` and is `oneOf`-shaped per the discriminator. Non-TS validators get the same kind ↔ slice enforcement TypeScript consumers do. Every field carries a `description` keyword so the schema is also usable as an LLM tool-use document.

The canonical URL is pinned to **major.minor** so a future minor that adds a `kind` branch publishes at a new URL without invalidating existing references:

```text
https://unpkg.com/@mobile-surfaces/surface-contracts@5.0/schema.json
```

Ajv 2020 example:

```ts
import Ajv2020 from "ajv/dist/2020.js";

const ajv = new Ajv2020();
const schema = await fetch(
  "https://unpkg.com/@mobile-surfaces/surface-contracts@5.0/schema.json",
).then((r) => r.json());

const validate = ajv.compile(schema);
if (!validate(input)) {
  console.error(validate.errors);
}
```

The schema is also exported via the package's `./schema` subpath if you want to bundle it locally:

```ts
import schema from "@mobile-surfaces/surface-contracts/schema";
```

## v3 -> v4 migration

`schemaVersion: "4"` rebases the snapshot shape: the v3 base lost its kind-specific rendering fields and every per-kind slice carries its own rendering set. The notification slice renames `primaryText`/`secondaryText` to `title`/`body` so they line up with `aps.alert.title`/`aps.alert.body` on the wire. The control slice gains a required `label`. v3's `progress: 1` on control (fictional) and v3's `progress` on lockAccessory (which was only a projection-fallback source) are dropped from the wire shape.

Use `safeParseAnyVersion` at wire edges that may see either schema shape:

```ts
import { safeParseAnyVersion } from "@mobile-surfaces/surface-contracts";

const result = safeParseAnyVersion(rawBody);
if (!result.success) {
  return reject(result.error);
}

if (result.deprecationWarning) {
  log.warn(result.deprecationWarning, { snapshotId: result.data.id });
}

handle(result.data); // always v4
```

For stored payloads, `migrateV3ToV4` is a pure transform that lifts the v3 base's rendering fields into the per-kind slice and bumps `schemaVersion` to `"4"`. The v3 codec lives for the entire 5.x release line and is removed in 6.0.0. The v2 codec was sunset at 5.0 per the v3 RFC commitment; v2 producers must run their payloads through `@mobile-surfaces/surface-contracts@4` to reach v3 first. Full migration policy and a worked example live in [`https://mobile-surfaces.com/docs/schema-migration`](https://mobile-surfaces.com/docs/schema-migration).

## Pairing options

- **Use with `expo-live-activity`**: validate at the backend boundary with `assertSnapshot`, project via `toLiveActivityContentState`, and hand the content state to your existing push library. Nothing in this package imports any bridge.
- **Use with the Mobile Surfaces starter**: the harness already validates, projects, writes shared App Group state, and ships the matching widget extension. Run `npm create mobile-surfaces@latest` and you don't write any of the boilerplate above.
- **Use with the Mobile Surfaces push SDK**: pair with [`@mobile-surfaces/push`](https://www.npmjs.com/package/@mobile-surfaces/push) for an APNs client that consumes `LiveSurfaceSnapshot` directly: alerts, Live Activity start/update/end, push-to-start (iOS 17.2+), and broadcast channels (iOS 18+) with zero npm runtime deps.

## License

MIT
