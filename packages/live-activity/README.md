# @mobile-surfaces/live-activity

Expo native module wrapping ActivityKit start/update/end for iOS Live Activities, push-to-start tokens (iOS 17.2+), and broadcast channel pushes (iOS 18+). Speaks the `LiveSurfaceActivityContentState` shape from [`@mobile-surfaces/surface-contracts`](https://www.npmjs.com/package/@mobile-surfaces/surface-contracts) so your JS, your push backend, and the Swift attribute file all agree on the same wire layout.

This bridge is intentionally narrower than [`expo-live-activity`](https://github.com/software-mansion-labs/expo-live-activity). It exposes the surface the Mobile Surfaces reference architecture needs and nothing else; APIs like custom presentation images and arbitrary attribute trees are not bridged. If you need those, pair the contract package with `expo-live-activity` directly.

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

iOS Live Activity tokens never arrive synchronously. The native module exposes three event streams that you subscribe to at mount time, plus one async probe that returns the most-recent push-to-start token the bridge has observed:

| Event | When it fires | Why subscribe at mount |
| --- | --- | --- |
| `onPushToken` | ActivityKit hands the JS layer a per-activity push token, on start and on rotation. | Tokens rotate at any time ([MS020](https://mobile-surfaces.com/docs/push#token-taxonomy)). Subscribing once at mount lets you re-store on every emission keyed by `activityId`. |
| `onActivityStateChange` | The activity transitions between `active`, `ended`, `dismissed`, `stale`, `pending`, or `unknown`. | Wire it to your token store so terminal states ([MS021](https://mobile-surfaces.com/docs/push#token-taxonomy)) stop selecting dead tokens for sends. |
| `onPushToStartToken` | iOS 17.2+ emits a fresh push-to-start token on cold launch, system rotation, and bridge reattach. | The token may rotate at any time ([MS016](https://mobile-surfaces.com/docs/push#token-taxonomy)). Subscribe on mount or the backend never sees a rotation. |
| `getPushToStartToken()` (async probe, no event) | Resolves to the cached value of the most recent `onPushToStartToken` emission this process has seen, or `null` if none has fired yet. The cache is in-process; a fresh launch starts empty until the subscription fires. | Useful for hydration paths that want to short-circuit on a known token without waiting for the next emission; never a substitute for the subscription. |

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

- **No APNs sending.** Pair with [`@mobile-surfaces/push`](https://www.npmjs.com/package/@mobile-surfaces/push) (or any APNs library) on the backend. This package is the device-side bridge only.
- **No widget rendering.** Live Activities + Dynamic Island only. Home-screen widgets, control widgets, Lock Screen accessories, and StandBy widgets live in their own targets and read App Group state directly. See [`https://mobile-surfaces.com/docs/multi-surface`](https://mobile-surfaces.com/docs/multi-surface).
- **No custom images or arbitrary attribute trees.** Use `expo-live-activity` if you need them; this bridge stays narrow on purpose so MS002/MS003 byte-identity stays trivially auditable.

## What this package does (that you might not expect)

- **`start` / `update` Zod-parse their `LiveActivityContentState` argument before crossing the bridge.** A mismatch throws `InvalidContentStateError` (bound to [MS038](https://mobile-surfaces.com/docs/architecture#adapter-contract)) at the call site rather than producing a silent Lock Screen no-show. You should still validate inbound payloads at your wire boundary with `@mobile-surfaces/surface-contracts`; the adapter parse is a backstop, not a replacement.
- **`relevanceScore` is supported.** Pass it as an option to `start` / `update` and it is forwarded to ActivityKit. Range `[0, 1]`; the OS uses it to decide which Live Activity to surface when several are active.

## License

MIT
