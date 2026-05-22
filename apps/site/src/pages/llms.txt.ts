// The /llms.txt index per the llmstxt.org convention: a brief, link-only
// map of the site for LLM crawlers. The full trap catalog is mirrored at
// /llms-full.txt; this file is the concise index that points at it.
//
// This route is GENERATED from source so it cannot rot:
//   - the catalog headline counts come from data/catalog-stats.json
//     (itself generated from data/traps.json by generate-catalog-stats.mjs),
//     so the numbers stay correct as rules are added or retired;
//   - the documentation links come from the docs content collection, so
//     every link resolves to a real /docs/<slug> page.
//
// Astro pre-renders this endpoint to a static dist/llms.txt at build time.
// The old hand-maintained public/llms.txt was removed when this landed.

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import catalogStats from "../../../../data/catalog-stats.json";

// Reading order for the docs map mirrors the sidebar `order` frontmatter.
// catalog-maintenance is the catalog-editing workflow doc, not a reader
// path, so it is excluded from the concise index.
const EXCLUDED_SLUGS = new Set(["catalog-maintenance"]);

export const GET: APIRoute = async () => {
  const docs = (await getCollection("docs"))
    .filter((doc) => !EXCLUDED_SLUGS.has(doc.id))
    .sort((a, b) => a.data.order - b.data.order);

  const docLines = docs.map((doc) => {
    const summary = doc.data.description ?? "";
    return `- [${doc.data.title}](https://mobile-surfaces.com/docs/${doc.id})${
      summary ? `: ${summary}` : ""
    }`;
  });

  const content = `# Mobile Surfaces

> The fastest way to ship Live Activities, Dynamic Island, widgets, and controls on iPhone. An Expo iOS reference architecture with a working harness, push SDK, contract types, and a ${catalogStats.live}-entry catalog of silent-failure traps. Requires iOS 17.2 or higher.

## Install

\`npm create mobile-surfaces\` (also works with pnpm, yarn, bun)

## Repository

https://github.com/glendonC/mobile-surfaces

## Full content

The full trap catalog is mirrored at [/llms-full.txt](https://mobile-surfaces.com/llms-full.txt) so you can fetch the entire reference without following GitHub links.

## Catalog

The trap catalog is ${catalogStats.live} live rules (${catalogStats.bySeverity.error} error, ${catalogStats.bySeverity.warning} warning, ${catalogStats.bySeverity.info} info); ${catalogStats.prGated} are enforced at PR time by \`pnpm surface:check\`. Treat every \`error\` rule as a hard invariant. The rendered per-rule catalog with symptom, fix, and enforcement script is at [/traps](https://mobile-surfaces.com/traps).

## Documentation

${docLines.join("\n")}

## Tech stack

- Expo SDK with Continuous Native Generation
- React Native
- TypeScript
- Zod (contract validation)
- @bacons/apple-targets (widget target management; pin exact version)
- iOS 17.2 or higher (push-to-start tokens require this floor)
`;

  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
