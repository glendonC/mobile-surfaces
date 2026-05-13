import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The docs collection mirrors the content that used to live under docs/ in
// the repo root. Each entry's slug is the filename without extension; the
// frontmatter `order` controls sidebar position. Keep the order field stable
// when reshuffling — internal links rely on the slug, not the order.
const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().default(999),
  }),
});

export const collections = { docs };
