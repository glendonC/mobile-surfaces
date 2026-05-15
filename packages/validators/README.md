# @mobile-surfaces/validators

Project-identity input regexes for Mobile Surfaces scaffolding — project slug, URL scheme, bundle identifier, Apple Team ID, Swift identifier — consumed by [`create-mobile-surfaces`](https://www.npmjs.com/package/create-mobile-surfaces) and by the in-template `scripts/rename-starter.mjs`.

This is **not** wire-shape validation. If you are looking for a way to validate a `LiveSurfaceSnapshot` payload before sending it to APNs, see [`@mobile-surfaces/surface-contracts`](https://www.npmjs.com/package/@mobile-surfaces/surface-contracts), which exports the Zod schema and `safeParse` helpers.

Why a separate published package, not just a CLI internal? `create-mobile-surfaces` imports these via the bare specifier post-install; `rename-starter.mjs` ships into the scaffolded project and imports the same source via a relative path before `pnpm install` has run. Both paths must land on the same regex, so the regexes live in one published package and a guard script (`scripts/check-validator-sync.mjs`) enforces the dual-import sync.

## Install

```bash
pnpm add @mobile-surfaces/validators
```

Zero runtime dependencies. Node 18+. ESM-only (`type: "module"`).

## API

Each `validate*` function returns `undefined` on success and a human-readable error string on failure. Consumers wrap the string with their own emission policy — the CLI re-prompts; the rename script prints and exits.

```ts
import {
  validateProjectSlug,
  validateScheme,
  validateBundleId,
  validateTeamId,
  validateSwiftIdentifier,
  toScheme,
  toBundleId,
  toSwiftPrefix,
} from "@mobile-surfaces/validators";

validateProjectSlug("my-app");          // → undefined
validateProjectSlug("My App");          // → "Lowercase letters, digits, and dashes only…"
validateBundleId("com.example.demo");   // → "com.example.* is a placeholder Apple rejects on upload…"
validateBundleId("com.acme.demo");      // → undefined

toScheme("My App");        // → "myapp"
toBundleId("My App");      // → "com.example.myapp"
toSwiftPrefix("my-cool-app"); // → "MyCoolApp"
```

| Function | Accepts | Notes |
| --- | --- | --- |
| `validateProjectSlug(s)` | `[a-z0-9][a-z0-9-]*` | Becomes the folder name and the iOS Settings display name. |
| `validateScheme(s)` | `[a-z][a-z0-9]*` | URL scheme. Letters and digits only; must start with a letter. |
| `validateBundleId(s)` | reverse-DNS, ≥ 2 segments | Rejects the `com.example.*` placeholder Apple will refuse on upload. |
| `validateTeamId(s)` | empty or `[A-Z0-9]{10}` | Optional at scaffold time; APNs send paths enforce presence separately. |
| `validateSwiftIdentifier(s)` | `[A-Z][A-Za-z0-9_]*` | UpperCamelCase only. Used for the Swift namespace prefix. |
| `toScheme(projectName)` | — | Strip-non-alphanumeric helper for default scheme values. |
| `toBundleId(projectName)` | — | Default `com.example.*` placeholder. The CLI's `validateBundleId` rejects this; the rename flow surfaces it as a prompt default. |
| `toSwiftPrefix(projectName)` | — | UpperCamelCase prefix for Swift identifiers (widget bundle name, Live Activity attributes, etc.). |

## Why a separate package?

The CLI and the rename script run in different environments:

- `create-mobile-surfaces` runs in the user's terminal **before** the project exists. It imports validators via the bare specifier (`@mobile-surfaces/validators`) once the CLI's own dependencies have installed.
- `scripts/rename-starter.mjs` runs **inside** the scaffolded project, before `pnpm install` has been run. It imports validators via a relative path because there's no `node_modules/` yet.

Both paths land on the same source. The package is published so downstream tools (other generators, CI scripts, AI agents) can reuse the contract without copying regexes around.

## License

MIT
