// Serves the raw markdown body of each doc at /docs/<slug>.md so that
// LLM clients and the "View as markdown" action have a stable URL to fetch.
// Astro pre-renders one static .md file per entry at build time.

import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection("docs");
  return entries.map((entry) => ({
    params: { slug: entry.id },
    props: { body: entry.body ?? "" },
  }));
};

export const GET: APIRoute = ({ props }) => {
  const body = (props as { body: string }).body;
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
