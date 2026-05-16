# @mobile-surfaces/traps

Catalog, error base, URL builder, and Swift binding codegen for Mobile
Surfaces. Imported by every other Mobile Surfaces package that throws or
reports diagnostics; not user-facing.

## What lives here

- `MobileSurfacesError` — abstract base class. Every error thrown by
  `@mobile-surfaces/push`, `@mobile-surfaces/surface-contracts`,
  `@mobile-surfaces/live-activity`, and `@mobile-surfaces/validators`
  ultimately derives from this. Lazy `trapId` and `docsUrl` getters
  resolve through the generated bindings, so subclasses only set
  `this.name`.
- `TRAP_BINDINGS` and `TrapIds` — generated from `data/traps.json` at
  the repo root. Includes the runtime-reachable subset of every trap
  entry (id, title, severity, detection, summary, symptom, fix,
  `docsUrl`, plus optional `deprecated` and `siblings` cross-refs).
- `docsUrlFor(id, title)` — single URL builder. Every renderer (the
  generator, `scripts/build-agents-md.mjs`, the CLI error formatter)
  imports from here, so the slug algorithm cannot drift.
- `swift/MobileSurfacesTraps.swift` — generated Swift `MSTrapBound`
  protocol + `MSTraps` lookup table. Byte-identity replicated into
  `packages/live-activity/ios/` (for the native module pod) and
  `apps/mobile/targets/_shared/` (for widget + notification-content
  extensions via the `_shared/` auto-membership convention). MS040
  enforces the three copies stay in sync.

## Release group

`@mobile-surfaces/traps` ships in the linked release group with
`@mobile-surfaces/surface-contracts` and `@mobile-surfaces/validators`.
The three packages always bump majors together; the rest of the
monorepo versions independently. See `notes/refactor-v7.md`.

## Regenerating

Edit `data/traps.json`. Then run:

```sh
node --experimental-strip-types scripts/generate-traps-package.mjs
```

`pnpm surface:check` runs the generator with `--check` to fail CI on
drift.
