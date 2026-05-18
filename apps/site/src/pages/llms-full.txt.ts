// Mirror the project's AGENTS.md at /llms-full.txt so an LLM crawler
// can fetch the full trap catalog without having to follow a GitHub
// link. The /llms.txt at the site root is the brief index; this is the
// full content per the llmstxt.org convention.
//
// We read AGENTS.md (not CLAUDE.md) because AGENTS.md carries the full
// per-rule prose. CLAUDE.md is a compact index that Claude Code auto-
// loads at conversation start; both files are generated from the same
// data/traps.json source by scripts/build-agents-md.mjs.
//
// Astro pre-renders this endpoint to a static file at build time, so
// the GET handler runs once with `process.cwd()` set to apps/site/ and
// the content gets baked into dist/llms-full.txt.

import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";

// AGENTS.md sits four directories above this file:
//   apps/site/src/pages/llms-full.txt.ts → apps/site/src/pages
//   ../ ../ ../ ../ → mobile-surfaces (repo root)
const AGENTS_MD_URL = new URL("../../../../AGENTS.md", import.meta.url);

export const GET: APIRoute = async () => {
  const content = await readFile(AGENTS_MD_URL, "utf8");
  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
