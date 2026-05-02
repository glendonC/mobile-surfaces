// Astro config. Tailwind v4 hooks in via the Vite plugin (no separate
// @astrojs/tailwind integration in v4). Site URL is set so generated
// canonical URLs and the future sitemap point at the production domain;
// override via ASTRO_SITE for previews.

import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: process.env.ASTRO_SITE ?? "https://mobile-surfaces.com",
  vite: {
    plugins: [tailwindcss()],
  },
});
