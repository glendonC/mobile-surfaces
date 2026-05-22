#!/usr/bin/env node
// Validate every internal link in the repo's markdown docs so a dead
// relative path, a misspelled doc slug, or a stale anchor fragment fails
// CI instead of shipping silently.
//
// Why this exists: the audit that prompted this script found ~12 broken
// trap-anchor links. They all looked plausible — `/docs/traps#ms010-...`
// — but pointed at the wrong page (the catalog-maintenance doc, which has
// no per-rule anchors) or carried a truncated anchor that no heading
// emits. Nothing caught them because no check validated link targets.
// Anchors are the failure class that bit hardest, so anchor validation is
// the core of this script.
//
// Scope: in-repo / internal links only. External `http(s)://` URLs and
// `mailto:` are out of scope (network-dependent, churny, not our bug
// class). The link classes validated:
//
//   1. In-page fragment `#anchor`
//        -> must match a heading slug in the same markdown file.
//   2. Relative path `./x` or `../x` (optionally `#frag`)
//        -> the target file must exist on disk. A `#frag` on a markdown
//           target is checked against that file's heading slugs.
//   3. Site doc route `/docs/<slug>` (optionally `#frag`)
//        -> `<slug>` must be a doc in apps/site/src/content/docs/. A
//           `#frag` is checked against that doc's heading slugs.
//   4. Trap catalog route `/traps` (optionally `#frag`)
//        -> a `#frag` must match the anchorFor() slug of a live (non-
//           deprecated) entry in data/traps.json. This mirrors the
//           anchorFor() function in apps/site/src/pages/traps.astro.
//
// Other absolute site routes (e.g. `/`, `/docs`) are accepted without a
// deeper check — they are page routes, not the bug class here.
//
// Coverage: apps/site/src/content/docs/*.md, root README.md and
// CONTRIBUTING.md, and packages/*/README.md. notes/ (historical RFCs)
// and CHANGELOG.md basenames are excluded, matching check-doc-*.mjs.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-doc-links";
const repoRoot = path.resolve(".");

// Markdown files to scan, repo-root-relative. The docs collection is
// globbed; the standalone docs are listed explicitly.
function collectTargets() {
  const targets = [];
  const docsDir = path.join("apps", "site", "src", "content", "docs");
  const absDocsDir = path.join(repoRoot, docsDir);
  if (fs.existsSync(absDocsDir)) {
    for (const name of fs.readdirSync(absDocsDir)) {
      if (name.endsWith(".md")) targets.push(`${docsDir}/${name}`);
    }
  }
  for (const standalone of ["README.md", "CONTRIBUTING.md"]) {
    if (fs.existsSync(path.join(repoRoot, standalone))) {
      targets.push(standalone);
    }
  }
  const pkgDir = path.join(repoRoot, "packages");
  if (fs.existsSync(pkgDir)) {
    for (const pkg of fs.readdirSync(pkgDir)) {
      const readme = `packages/${pkg}/README.md`;
      if (fs.existsSync(path.join(repoRoot, readme))) targets.push(readme);
    }
  }
  return targets.sort();
}

// GitHub-style heading slug: lowercase, strip non-alphanumerics to single
// hyphens, trim. The same algorithm Astro/rehype use for `id` attributes.
function headingSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// anchorFor() from apps/site/src/pages/traps.astro: the heading is
// `${id}: ${title}`, slugified the same way. Mirrored here so trap-anchor
// links are validated against exactly what the catalog page emits.
function trapAnchor(entry) {
  return headingSlug(`${entry.id}: ${entry.title}`);
}

// Extract heading slugs from a markdown file. ATX headings only (`#`..
// `######`); fenced code blocks are skipped so `# comment` lines inside
// snippets are not mistaken for headings.
function headingSlugsOf(markdown) {
  const slugs = new Set();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (h) {
      // Strip inline markdown (links, code, emphasis) before slugifying so
      // the slug matches what a renderer emits from the rendered text.
      const text = h[1]
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_]/g, "");
      slugs.add(headingSlug(text));
    }
  }
  return slugs;
}

// Markdown link extractor. Captures the URL inside `](...)`, ignoring
// image links is unnecessary — a broken image link is still a bug. We do
// skip links inside fenced code blocks (illustrative, not navigable).
function* linksOf(markdown) {
  const lines = markdown.split("\n");
  let inFence = false;
  const linkRe = /\[(?:[^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    linkRe.lastIndex = 0;
    let m;
    while ((m = linkRe.exec(line)) !== null) {
      yield { url: m[1], line: i + 1 };
    }
  }
}

// --- Build the resolver indexes -----------------------------------------

// docs collection: slug (filename minus .md) -> heading-slug Set.
const docsDir = path.join(repoRoot, "apps", "site", "src", "content", "docs");
const docSlugToHeadings = new Map();
if (fs.existsSync(docsDir)) {
  for (const name of fs.readdirSync(docsDir)) {
    if (!name.endsWith(".md")) continue;
    const slug = name.slice(0, -3);
    const src = fs.readFileSync(path.join(docsDir, name), "utf8");
    docSlugToHeadings.set(slug, headingSlugsOf(src));
  }
}

// Live trap anchors from data/traps.json.
const trapAnchors = new Set();
const trapsJsonPath = path.join(repoRoot, "data", "traps.json");
if (fs.existsSync(trapsJsonPath)) {
  const catalog = JSON.parse(fs.readFileSync(trapsJsonPath, "utf8"));
  for (const entry of catalog.entries ?? []) {
    if (entry.deprecated) continue;
    trapAnchors.add(trapAnchor(entry));
  }
}

// --- Validate -----------------------------------------------------------

const issues = [];
const targets = collectTargets();

for (const rel of targets) {
  const abs = path.join(repoRoot, rel);
  const src = fs.readFileSync(abs, "utf8");
  const ownHeadings = headingSlugsOf(src);

  for (const { url, line } of linksOf(src)) {
    // Out of scope: external URLs, protocol-relative, mail/tel.
    if (/^([a-z]+:)?\/\//i.test(url) || /^(mailto|tel):/i.test(url)) {
      continue;
    }

    const at = `${rel}:${line}`;
    const hashIndex = url.indexOf("#");
    const pathPart = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const frag = hashIndex === -1 ? "" : url.slice(hashIndex + 1);

    // Class 1: in-page fragment.
    if (pathPart === "") {
      if (frag && !ownHeadings.has(frag)) {
        issues.push({
          path: at,
          message: `in-page anchor #${frag} matches no heading in this file`,
        });
      }
      continue;
    }

    // Class 4: trap catalog route.
    if (pathPart === "/traps") {
      if (frag && !trapAnchors.has(frag)) {
        issues.push({
          path: at,
          message: `/traps#${frag} matches no live trap anchor (see anchorFor() in traps.astro)`,
        });
      }
      continue;
    }

    // Class 3: site doc route.
    if (pathPart.startsWith("/docs/")) {
      const slug = pathPart.slice("/docs/".length).replace(/\/$/, "");
      if (!docSlugToHeadings.has(slug)) {
        issues.push({
          path: at,
          message: `/docs/${slug} matches no doc in apps/site/src/content/docs/`,
        });
        continue;
      }
      if (frag && !docSlugToHeadings.get(slug).has(frag)) {
        issues.push({
          path: at,
          message: `/docs/${slug}#${frag} matches no heading in ${slug}.md`,
        });
      }
      continue;
    }

    // Other absolute site routes (`/`, `/docs`, `/traps` handled above):
    // page routes, not a doc-link bug class. Accept without deeper check.
    if (pathPart.startsWith("/")) {
      continue;
    }

    // Class 2: relative path. Resolve against the file's directory.
    const resolved = path.resolve(path.dirname(abs), pathPart);
    if (!fs.existsSync(resolved)) {
      issues.push({
        path: at,
        message: `relative link ${pathPart} resolves to a missing file`,
      });
      continue;
    }
    if (frag && resolved.endsWith(".md")) {
      const targetHeadings = headingSlugsOf(
        fs.readFileSync(resolved, "utf8"),
      );
      if (!targetHeadings.has(frag)) {
        issues.push({
          path: at,
          message: `anchor #${frag} matches no heading in ${pathPart}`,
        });
      }
    }
  }
}

emitDiagnosticReport(
  buildReport(TOOL, [
    {
      id: "doc-links",
      status: issues.length === 0 ? "ok" : "fail",
      summary:
        issues.length === 0
          ? `All internal links across ${targets.length} markdown file(s) resolve.`
          : `${issues.length} broken internal link(s) across ${targets.length} markdown file(s).`,
      ...(issues.length > 0
        ? {
            detail: {
              message:
                "Fix each link to point at a real file, doc slug, or anchor. Trap anchors must match anchorFor() in apps/site/src/pages/traps.astro.",
              issues,
            },
          }
        : {}),
    },
  ]),
  { json: values.json },
);
