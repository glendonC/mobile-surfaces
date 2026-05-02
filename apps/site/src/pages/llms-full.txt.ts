// Mirror the project's CLAUDE.md at /llms-full.txt so an LLM crawler
// can fetch the full trap catalog without having to follow a GitHub
// link. The /llms.txt at the site root is the brief index; this is the
// full content per the llmstxt.org convention.
//
// Astro pre-renders this endpoint to a static file at build time, so
// the GET handler runs once with `process.cwd()` set to apps/site/ and
// the content gets baked into dist/llms-full.txt.

import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";

// CLAUDE.md sits four directories above this file:
//   apps/site/src/pages/llms-full.txt.ts → apps/site/src/pages
//   ../ ../ ../ ../ → mobile-surfaces (repo root)
const CLAUDE_MD_URL = new URL("../../../../CLAUDE.md", import.meta.url);

export const GET: APIRoute = async () => {
  const content = await readFile(CLAUDE_MD_URL, "utf8");
  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
