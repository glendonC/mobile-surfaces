// Astro config. Tailwind v4 hooks in via the Vite plugin (no separate
// @astrojs/tailwind integration in v4). Site URL is set so generated
// canonical URLs and the future sitemap point at the production domain;
// override via ASTRO_SITE for previews.
//
// experimental.csp: Astro emits a per-page <meta http-equiv> CSP with
// SHA-256 hashes auto-generated for inline scripts and styles. The
// directives below cover everything Astro doesn't auto-handle. The
// matching Content-Security-Policy line is removed from public/_headers
// to avoid a stricter header overriding the meta tag. frame-ancestors
// can't be delivered via meta — X-Frame-Options: DENY in _headers
// covers the same clickjacking concern.

import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: process.env.ASTRO_SITE ?? "https://mobile-surfaces.com",
  vite: {
    plugins: [tailwindcss()],
  },
  experimental: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "upgrade-insecure-requests",
      ],
    },
  },
});
