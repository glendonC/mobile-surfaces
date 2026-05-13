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
    schemaVersion: "2",
    kind: "liveActivity",
    id: `${job.id}@${job.revision}`,
    surfaceId: `job-${job.id}`,
    updatedAt: new Date().toISOString(),
    state: job.status === "done" ? "completed" : "active",
    modeLabel: "active",
    contextLabel: job.queueName,
    statusLine: `${job.queueName} · ${Math.round(job.progress * 100)}%`,
    primaryText: job.title,
    secondaryText: job.subtitle ?? "",
    progress: job.progress,
    deepLink: `myapp://surface/job-${job.id}`,
    liveActivity: {
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

`liveSurfaceSnapshot` is a discriminated union: `kind` picks which branch is valid, and the validator rejects fields that belong to the wrong branch. It covers six branches at `schemaVersion: "2"`:

| `kind` | Renders as | Slice |
| --- | --- | --- |
| `liveActivity` | Lock Screen Live Activity, Dynamic Island | `liveActivity: { stage, estimatedSeconds, morePartsCount }` |
| `widget` | Home-screen widget | `widget: { family?, reloadPolicy? }` |
| `control` | iOS 18 control widget | `control: { kind, state?, intent? }` |
| `notification` | Notification content | `notification: { category?, threadId? }` |
| `lockAccessory` | Lock Screen complication | `lockAccessory: { family, gaugeValue?, shortText? }` |
| `standby` | StandBy mode widget | `standby: { presentation, tint? }` |

The base fields (`id`, `surfaceId`, `updatedAt`, `state`, `modeLabel`, `contextLabel`, `statusLine`, `primaryText`, `secondaryText`, `actionLabel?`, `progress`, `deepLink`) are shared across every branch. `liveActivity`-only timing and stage hints (the three fields in the `liveActivity` slice) moved out of the base in v2; v1 carried them on every kind.

`kind`-aware narrowing is enforced both at parse time (a `kind: "control"` snapshot without a `control` slice fails `safeParse`) and at projection time (`toLiveActivityContentState` rejects a non-`liveActivity` snapshot at runtime):

```ts
import {
  assertSnapshot,
  toWidgetTimelineEntry,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";

const snapshot = assertSnapshot(input);

if (snapshot.kind === "widget") {
  // TS narrows: `snapshot.widget` is now LiveSurfaceWidgetSlice.
  const entry = toWidgetTimelineEntry(snapshot);
  writeAppGroupEntry(entry);
}
```

Projection helpers exported today: `toLiveActivityContentState`, `toWidgetTimelineEntry`, `toControlValueProvider`, `toNotificationContentPayload`, `toLockAccessoryEntry`, `toStandbyEntry`. The APNs alert-payload helper `liveActivityAlertPayloadFromSnapshot` lives in [`@mobile-surfaces/push`](https://www.npmjs.com/package/@mobile-surfaces/push) since 3.0 (the `aps` envelope is wire format, not a contract concern). See [`docs/multi-surface.md`](../../docs/multi-surface.md) for what each helper returns and when to emit each `kind`.

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

Backends that aren't on TypeScript can validate against the published JSON Schema, which is generated by `z.toJSONSchema` and is `oneOf`-shaped per the discriminator. Non-TS validators get the same kind ↔ slice enforcement TypeScript consumers do.

The canonical URL is pinned to **major.minor** so a future minor that adds a `kind` branch publishes at a new URL without invalidating existing references:

```text
https://unpkg.com/@mobile-surfaces/surface-contracts@3.0/schema.json
```

Ajv 2020 example:

```ts
import Ajv2020 from "ajv/dist/2020.js";

const ajv = new Ajv2020();
const schema = await fetch(
  "https://unpkg.com/@mobile-surfaces/surface-contracts@3.0/schema.json",
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

## v1 -> v2 migration

`schemaVersion: "2"` reshapes the v1 base to move `stage`/`estimatedSeconds`/`morePartsCount` into the `liveActivity` slice, promotes `updatedAt` to required, and removes the v1 missing-`kind` preprocess. Use `safeParseAnyVersion` at wire edges that may see either schema shape:

```ts
import { safeParseAnyVersion } from "@mobile-surfaces/surface-contracts";

const result = safeParseAnyVersion(rawBody);
if (!result.success) {
  return reject(result.error);
}

if (result.deprecationWarning) {
  log.warn(result.deprecationWarning, { snapshotId: result.data.id });
}

handle(result.data); // always v2
```

For stored payloads, `migrateV1ToV2` is a pure transform that pulls the three liveActivity-only fields under the `liveActivity` slice and bumps `schemaVersion` to `"2"`. v1's `updatedAt` was optional; v2 requires it. The codec leaves missing `updatedAt` undefined by default so the result fails v2 parse loudly; callers who know it is safe can pass `migrateV1ToV2(v1, { updatedAtFallback: "..." })`. The codec lives for the entire 3.x release line and is removed in 4.0.0. Full migration policy and a worked example live in [`docs/schema-migration.md`](../../docs/schema-migration.md).

## Pairing options

- **Use with `expo-live-activity`**: validate at the backend boundary with `assertSnapshot`, project via `toLiveActivityContentState`, and hand the content state to your existing push library. Nothing in this package imports any bridge.
- **Use with the Mobile Surfaces starter**: the harness already validates, projects, writes shared App Group state, and ships the matching widget extension. Run `npm create mobile-surfaces@latest` and you don't write any of the boilerplate above.
- **Use with the Mobile Surfaces push SDK**: pair with [`@mobile-surfaces/push`](https://www.npmjs.com/package/@mobile-surfaces/push) for an APNs client that consumes `LiveSurfaceSnapshot` directly: alerts, Live Activity start/update/end, push-to-start (iOS 17.2+), and broadcast channels (iOS 18+) with zero npm runtime deps.

## License

MIT
