---
"create-mobile-surfaces": patch
---

Remove the broken `mobile-surfaces` bin entry from `package.json`. The declared file `./bin/mobile-surfaces.mjs` was never created, so `npm i -g create-mobile-surfaces` shipped a broken symlink that failed with `ENOENT` on first use. The corresponding `Also ships the mobile-surfaces audit subcommand...` sentence is removed from the package `description` for the same reason.

The unreachable `src/audit.mjs` orchestrator remains in the tree. v9 will either wire it through a real bin entry with the script-bundling fix it needs (see `notes/audit-state.md` task #9) or remove it.
