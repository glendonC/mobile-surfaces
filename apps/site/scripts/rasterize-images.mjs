// Rasterize SVG sources in public/ to PNG. Run via `pnpm og` after
// editing the source SVG; commit the PNG alongside it.
//
// We use @resvg/resvg-js (Rust SVG renderer) so the conversion is
// deterministic and runs headlessly. The Geist woff2 files from
// Fontsource are loaded explicitly so OG card text renders in-brand
// instead of falling back to system serifs.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const fontFiles = [
  require.resolve(
    "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  ),
  require.resolve(
    "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  ),
];

const targets = [
  { in: "og.svg", out: "og.png", width: 1200, needsFonts: true },
  {
    in: "apple-touch-icon.svg",
    out: "apple-touch-icon.png",
    width: 180,
    needsFonts: false,
  },
  // Logo lockup at marketing-hero scale (1200 wide for README and decks)
  { in: "logo.svg", out: "logo.png", width: 1200, needsFonts: true },
  // Icon-only mark at avatar scale (square, 512×512)
  {
    in: "logo-mark.svg",
    out: "logo-mark.png",
    width: 512,
    needsFonts: false,
  },
];

for (const { in: inFile, out, width, needsFonts } of targets) {
  const svg = readFileSync(join(publicDir, inFile));
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    logLevel: "warn",
    font: needsFonts
      ? {
          fontFiles,
          // Fall back to system fonts if resvg can't resolve a glyph
          // from the loaded woff2. macOS Helvetica is the realistic
          // fallback if Geist's variable axis trips up usvg.
          loadSystemFonts: true,
          defaultFontFamily: "Geist",
        }
      : { loadSystemFonts: false },
  });
  const png = resvg.render().asPng();
  writeFileSync(join(publicDir, out), png);
  console.log(`  ${inFile} → ${out}  (${png.length.toLocaleString()} bytes)`);
}
