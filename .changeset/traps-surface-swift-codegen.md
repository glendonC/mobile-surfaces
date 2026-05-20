---
"@mobile-surfaces/traps": minor
---

Repoint MS036 (surface snapshot Swift structs match their Zod projection-output schemas) at `scripts/generate-surface-swift.mjs`.

The four surface snapshot structs and the notification-content entry struct are now generated from their Zod schemas instead of hand-maintained. The structs are correct by construction; the single remaining failure mode — a committed Swift file drifting from the generator output — is caught by `generate-surface-swift.mjs --check`. The standalone semantic parity checker `check-surface-snapshots.mjs` is retired.

Public-surface impact for `@mobile-surfaces/traps` consumers: `findTrap("MS036").enforcement.script` changes from `scripts/check-surface-snapshots.mjs` to `scripts/generate-surface-swift.mjs`, and the rule's `summary` and `fix` prose now describe the generated structs and the codegen workflow.
