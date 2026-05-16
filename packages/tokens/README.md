# @mobile-surfaces/tokens

Token store and forwarder for Mobile Surfaces. Owns the MS020 and MS021
invariants — treat every token emission as authoritative, mark
per-activity tokens dead on terminal lifecycle — so application code
does not have to re-derive them at every call site.

## What lives here

Four pieces, each importable separately so a consumer pulls in only
what they need:

- **`@mobile-surfaces/tokens`** — vanilla `createTokenStore(opts)`. No
  React. No native dependency. Drives the lifecycle state machine and
  exposes a `subscribe(listener)` callback. Suitable for use inside a
  Node test, a worker, or any non-React surface.
- **`@mobile-surfaces/tokens/react`** — `useTokenStore({ adapter, ... })`
  hook. Wires the adapter's `onPushToken`, `onPushToStartToken`, and
  `onActivityStateChange` listeners to the store at mount, tears down
  at unmount, and returns a reactive `TokenStore`.
- **`@mobile-surfaces/tokens/forwarder`** — `createTokenForwarder(cfg)`.
  Posts records to a backend URL with the same exponential-backoff /
  jitter shape as `@mobile-surfaces/push`. Used from inside the React
  hook or directly from server-side code.
- **`@mobile-surfaces/tokens/wire`** — Zod schemas for the
  forwarder request body. Shared client and server.

## Why this isn't in `@mobile-surfaces/live-activity`

The live-activity package is the JS adapter for ActivityKit. Pulling a
React hook into it would force backend consumers (server code calling
the adapter to construct content states for tests) to import React
typings, and would block tree-shaking of the hook on platforms where
the adapter is the only consumer. The two packages also rev
independently: the adapter contract is stable, but the token store's
storage shape can grow without bumping the adapter surface.

## Storage adapters

The vanilla store accepts a `TokenStorage` implementation via
`createTokenStore({ storage })`. Three are bundled:

- `@mobile-surfaces/tokens/storage/memory` — in-process Map. The
  default when no storage is provided. Cleared on process restart.
- `@mobile-surfaces/tokens/storage/async-storage` — backs the store
  with `@react-native-async-storage/async-storage`. The peer dep is
  declared optional, so consumers add it to their own
  `package.json` if they use this adapter.
- `@mobile-surfaces/tokens/storage/secure-store` — backs the store
  with `expo-secure-store`. Same optional peer-dep arrangement.

## Discipline

Application code under `apps/*/src/` must not call
`adapter.addListener("onPushToken", ...)` (or its siblings) directly.
MS039 enforces this with a static check; route through the store or
the React hook so MS020 / MS021 stay load-bearing for every consumer.

## Release group

`@mobile-surfaces/tokens` versions independently of the linked
contract group (`surface-contracts` + `validators` + `traps`). It
depends on `@mobile-surfaces/traps` for the `MobileSurfacesError`
base and on `@mobile-surfaces/surface-contracts` only for the
adapter type imports the hook needs.
