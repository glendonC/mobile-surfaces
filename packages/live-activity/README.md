# @mobile-surfaces/live-activity

Expo native module wrapping ActivityKit start/update/end for iOS Live Activities, push-to-start tokens (iOS 17.2+), and broadcast channel pushes (iOS 18+). Speaks the `LiveSurfaceActivityContentState` shape from [`@mobile-surfaces/surface-contracts`](https://www.npmjs.com/package/@mobile-surfaces/surface-contracts) so your JS, your push backend, and the Swift attribute file all agree on the same wire layout.

This bridge is intentionally narrower than [`expo-live-activity`](https://github.com/software-mansion-labs/expo-live-activity). It exposes the surface the Mobile Surfaces reference architecture needs and nothing else; convenience APIs like `relevanceScore`, custom presentation images, and arbitrary attribute trees are not (yet) bridged. If you need those, pair the contract package with `expo-live-activity` directly.

## Install

```bash
pnpm add @mobile-surfaces/live-activity @mobile-surfaces/surface-contracts
```

Requires Expo SDK 55+, React Native 0.83+, React 19.2+, and iOS deployment target 17.2 or higher (push-to-start tokens are unconditional). The package ships an `expo-module.config.json` and an iOS sources directory; `expo prebuild --platform ios` picks them up automatically.

## The adapter boundary

App code never imports this package directly. The Mobile Surfaces starter ships a thin re-export at `apps/mobile/src/liveActivity` (the boundary trap [MS001](https://mobile-surfaces.com/docs/architecture#adapter-contract) enforces). Importing through that boundary means swapping in a different native module — `expo-live-activity`, a hand-rolled module, a future first-party Apple module — touches one file instead of every call site.

```ts
import { liveActivityAdapter, type LiveActivitySnapshot } from "../liveActivity";
```

## Quick example: start, update, end

```ts
import { liveActivityAdapter } from "../liveActivity";
import {
  toLiveActivityContentState,
  type LiveSurfaceSnapshotLiveActivity,
} from "@mobile-surfaces/surface-contracts";

async function startFromSnapshot(snapshot: LiveSurfaceSnapshotLiveActivity) {
  const state = toLiveActivityContentState(snapshot);
  const { id } = await liveActivityAdapter.start(
    snapshot.surfaceId,
    snapshot.liveActivity.modeLabel,
    state,
  );
  return id;
}

async function pushUpdate(activityId: string, snapshot: LiveSurfaceSnapshotLiveActivity) {
  await liveActivityAdapter.update(activityId, toLiveActivityContentState(snapshot));
}

await liveActivityAdapter.end(activityId, "default");
```

`start` accepts an optional `channelId` argument; passing it on iOS 18+ routes the activity through ActivityKit's broadcast channel topology (one APNs publish, many devices). Passing it on iOS < 18 throws `ACTIVITY_UNSUPPORTED_FEATURE` rather than silently downgrading to per-token.

## Event streams

iOS Live Activity tokens never arrive synchronously. The native module exposes three event streams that you subscribe to at mount time, plus one synchronous probe for the most-recent push-to-start token:

| Event | When it fires | Why subscribe at mount |
| --- | --- | --- |
| `onPushToken` | ActivityKit hands the JS layer a per-activity push token, on start and on rotation. | Tokens rotate at any time ([MS020](https://mobile-surfaces.com/docs/push#token-taxonomy)). Subscribing once at mount lets you re-store on every emission keyed by `activityId`. |
| `onActivityStateChange` | The activity transitions between `active`, `ended`, `dismissed`, `stale`, `pending`, or `unknown`. | Wire it to your token store so terminal states ([MS021](https://mobile-surfaces.com/docs/push#token-taxonomy)) stop selecting dead tokens for sends. |
| `onPushToStartToken` | iOS 17.2+ emits a fresh push-to-start token on cold launch, system rotation, and bridge reattach. | `getPushToStartToken()` always resolves null today; iOS does not expose a synchronous query ([MS016](https://mobile-surfaces.com/docs/push#token-taxonomy)). Subscribe on mount or the backend never receives a token. |
| `getPushToStartToken()` (sync probe, no event) | Reserved for parity with the adapter contract. Always resolves null — kept so consumers can sanity-check the bridge is wired and lean on the same shape across native module implementations. | — |

```ts
useEffect(() => {
  const tokenSub = liveActivityAdapter.addListener("onPushToken", ({ activityId, token }) => {
    tokenStore.upsert(activityId, token);
  });
  const stateSub = liveActivityAdapter.addListener("onActivityStateChange", ({ activityId, state }) => {
    if (state === "ended" || state === "dismissed") tokenStore.markTerminal(activityId);
  });
  const startSub = liveActivityAdapter.addListener("onPushToStartToken", ({ token }) => {
    backend.uploadPushToStartToken(token);
  });
  return () => {
    tokenSub.remove();
    stateSub.remove();
    startSub.remove();
  };
}, []);
```

A known iOS bug ([FB21158660](https://mobile-surfaces.com/docs/push#fb21158660-push-to-start-after-force-quit) / [MS019](https://mobile-surfaces.com/docs/troubleshooting)) can leave `onPushToStartToken` silent after a force-quit. There is no client workaround; document the recovery step ("open the app once") in your support runbooks.

## What this package does not do

- **No payload validation.** `start` / `update` accept a `LiveActivityContentState` (alias for `LiveSurfaceActivityContentState`); validate at the wire boundary with `@mobile-surfaces/surface-contracts`. The native bridge trusts what JS hands it.
- **No APNs sending.** Pair with [`@mobile-surfaces/push`](https://www.npmjs.com/package/@mobile-surfaces/push) (or any APNs library) on the backend. This package is the device-side bridge only.
- **No widget rendering.** Live Activities + Dynamic Island only. Home-screen widgets, control widgets, Lock Screen accessories, and StandBy widgets live in their own targets and read App Group state directly. See [`https://mobile-surfaces.com/docs/multi-surface`](https://mobile-surfaces.com/docs/multi-surface).
- **No `relevanceScore`, custom images, or arbitrary attributes.** Use `expo-live-activity` if you need them; this bridge stays narrow on purpose so MS002/MS003 byte-identity stays trivially auditable.

## License

MIT
