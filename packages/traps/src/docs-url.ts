// @mobile-surfaces/traps — docs-URL / slug leaf module.
//
// SINGLE source of truth for the per-trap docsUrl string. Two consumers
// must agree on the exact algorithm or the runtime `docsUrl` exported from
// @mobile-surfaces/traps drifts from the `docsUrl` baked into the generated
// bindings:
//
//   - scripts/generate-traps-package.mjs imports docsUrlFor from here to
//     stamp docsUrl into both the TS bindings and the Swift replicas.
//   - packages/traps/src/index.ts re-exports docsUrlFor from here for the
//     CLI error formatter and any external renderer.
//
// This module imports NOTHING from ./generated/bindings.ts (or anything
// downstream of codegen), so the generator can import it pre-install with
// no bootstrap cycle: the generator runs in a freshly extracted scaffold
// tarball before `pnpm install`, where the workspace symlink chain does not
// yet exist. A leaf module with no workspace imports is safe to pull in by
// relative path at that point.

import type { TrapId } from "./index.ts";

/**
 * Canonical deep-link base for per-trap docsUrl strings. AGENTS.md carries
 * the per-rule Symptom + Fix prose; CLAUDE.md is a compact index that points
 * back at AGENTS.md for the same anchors, so the actionable target is
 * AGENTS.md.
 */
export const DOCS_BASE_URL =
  "https://github.com/glendonC/mobile-surfaces/blob/main/AGENTS.md";

/**
 * GitHub markdown heading-slug algorithm: lowercase, replace any run of
 * non-alphanumeric characters with a single hyphen, trim leading/trailing
 * hyphens. Matches the anchors GitHub generates for the headings in
 * AGENTS.md / CLAUDE.md.
 */
export function githubAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Single URL builder. Every renderer (the generator, the CLI error
 * formatter, external doc tooling) calls this so the slug algorithm cannot
 * drift across consumers. The heading is `MSXXX: <title>` to match the
 * rendered heading shape in AGENTS.md.
 */
export function docsUrlFor(trapId: TrapId, title: string): string {
  return `${DOCS_BASE_URL}#${githubAnchor(`${trapId}: ${title}`)}`;
}
