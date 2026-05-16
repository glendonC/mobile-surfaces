#!/usr/bin/env node
// MS042: a "will be removed in X.0.0" claim must reference a major strictly
// past the current major of the package that owns it. Otherwise the prose
// promises a removal that has either already happened (and didn't) or is
// happening in the current release (and the codec is still here).
//
// Scope: TypeScript sources under packages/<X>/src/, every CHANGELOG body
// (excluded — historical), every .md doc page under apps/site/src/content/docs/
// and the root README.md. CHANGELOG.md files are skipped because they describe
// past versions where the prose was accurate-at-time-of-write.
//
// Resolution rules:
//   - For files under packages/<X>/, "current major" = packages/<X>/package.json
//     version's major.
//   - When the prose includes an explicit `@scope/name@X.0` reference, the
//     current major comes from that package's package.json instead.
//   - Otherwise the current major defaults to @mobile-surfaces/surface-contracts.
//
// Allowlist: a line immediately preceded by `// CHARTER: keep` (or
// `<!-- CHARTER: keep -->` for markdown) opts out. Use sparingly — the marker
// exists for the rare case where the deprecation prose intentionally describes
// a historical promise rather than a forward commitment.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, emitDiagnosticReport } from "./lib/diagnostics.mjs";

const { values } = parseArgs({
  options: { json: { type: "boolean", default: false } },
});

const TOOL = "check-deprecation-prose";
const REPO_ROOT = path.resolve(".");

// Match "will be removed in [@scope/pkg@]X.0[.0]". Captures the optional
// package qualifier and the major number. Case-insensitive for the
// "will be removed in" head.
const PROSE_RE =
  /will be removed in\s+(?:(@[\w-]+\/[\w-]+)@)?(\d+)\.0(?:\.0)?/gi;

// Allowlist markers. The TS/JS one is a `// CHARTER: keep` single-line comment
// on the line immediately preceding the prose. The markdown one is an HTML
// comment on the immediately-preceding non-blank line.
const TS_ALLOWLIST_RE = /^\s*\/\/\s*CHARTER:\s*keep\b/;
const MD_ALLOWLIST_RE = /^\s*<!--\s*CHARTER:\s*keep\s*-->\s*$/;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  ".turbo",
  ".next",
  ".astro",
  "coverage",
  "Pods",
  ".cache",
]);

const SKIP_BASENAMES = new Set(["CHANGELOG.md"]);

function readPackageMajor(pkgDir) {
  const pkgPath = path.join(REPO_ROOT, "packages", pkgDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (typeof pkg.version !== "string") return null;
    const major = Number(pkg.version.split(".")[0]);
    return { name: pkg.name ?? pkgDir, major };
  } catch {
    return null;
  }
}

function readPackageMajorByName(name) {
  // Try every packages/<dir>/package.json until a name match.
  const pkgDir = path.join(REPO_ROOT, "packages");
  if (!fs.existsSync(pkgDir)) return null;
  for (const entry of fs.readdirSync(pkgDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const info = readPackageMajor(entry.name);
    if (info && info.name === name) return info;
  }
  return null;
}

// Determine which package the prose's "current major" should be measured
// against. Order: explicit @scope/name reference > containing packages/<X>/
// directory > surface-contracts default.
function resolveCurrentMajor(filePathRel, explicitPkgName) {
  if (explicitPkgName) {
    const info = readPackageMajorByName(explicitPkgName);
    if (info) return { ...info, source: "explicit prose reference" };
  }
  const m = /^packages\/([^/]+)\//.exec(filePathRel);
  if (m) {
    const info = readPackageMajor(m[1]);
    if (info) return { ...info, source: `packages/${m[1]}/package.json` };
  }
  const fallback = readPackageMajorByName("@mobile-surfaces/surface-contracts");
  if (fallback) {
    return {
      ...fallback,
      source: "default (@mobile-surfaces/surface-contracts)",
    };
  }
  return null;
}

function* walkSources(dir, relDir = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkSources(path.join(dir, entry.name), childRel);
    } else if (entry.isFile()) {
      if (SKIP_BASENAMES.has(entry.name)) continue;
      // Sources in scope: TS/MTS under packages/*/src/, every .md under
      // apps/site/src/content/docs/, and the root README.md. Restrict to
      // these to keep the scan deterministic and fast.
      const inPackageSrc =
        childRel.startsWith("packages/") &&
        childRel.includes("/src/") &&
        /\.(ts|mts|tsx)$/.test(entry.name);
      const inDocsMd =
        childRel.startsWith("apps/site/src/content/docs/") &&
        entry.name.endsWith(".md");
      const isRootReadme = childRel === "README.md";
      if (inPackageSrc || inDocsMd || isRootReadme) {
        yield childRel;
      }
    }
  }
}

const issues = [];
let scanned = 0;

for (const rel of walkSources(REPO_ROOT)) {
  scanned += 1;
  const abs = path.join(REPO_ROOT, rel);
  const src = fs.readFileSync(abs, "utf8");
  const lines = src.split("\n");
  const isMarkdown = rel.endsWith(".md");
  PROSE_RE.lastIndex = 0;
  let m;
  while ((m = PROSE_RE.exec(src)) !== null) {
    const explicitPkg = m[1] ?? null;
    const promisedMajor = Number(m[2]);
    const upToMatch = src.slice(0, m.index);
    const lineIdx = upToMatch.split("\n").length - 1; // 0-based
    const lineNum = lineIdx + 1;

    // Check the allowlist marker on the immediately-preceding non-blank line
    // (markdown) or the immediately-preceding line (ts/js).
    let allowlisted = false;
    if (isMarkdown) {
      for (let i = lineIdx - 1; i >= 0; i -= 1) {
        const candidate = lines[i];
        if (candidate.trim() === "") continue;
        allowlisted = MD_ALLOWLIST_RE.test(candidate);
        break;
      }
    } else {
      const prev = lines[lineIdx - 1] ?? "";
      allowlisted = TS_ALLOWLIST_RE.test(prev);
    }
    if (allowlisted) continue;

    const ctx = resolveCurrentMajor(rel, explicitPkg);
    if (!ctx) {
      issues.push({
        path: `${rel}:${lineNum}`,
        message: `Could not resolve current major for ${explicitPkg ?? "(implicit)"}; cannot validate prose.`,
      });
      continue;
    }
    if (ctx.major >= promisedMajor) {
      issues.push({
        path: `${rel}:${lineNum}`,
        message: `deprecation promise broken: "${m[0]}" but ${ctx.name} is at major ${ctx.major} (${ctx.source}).`,
      });
    }
  }
}

emitDiagnosticReport(
  buildReport(TOOL, [
    {
      id: "deprecation-prose",
      status: issues.length === 0 ? "ok" : "fail",
      trapId: "MS042",
      summary:
        issues.length === 0
          ? `No broken deprecation promises across ${scanned} scanned file(s).`
          : `${issues.length} broken deprecation promise(s) across ${scanned} scanned file(s).`,
      ...(issues.length > 0
        ? {
            detail: {
              message:
                "Update each prose to a future major (charter minimum: one past current), or drop the deprecated codec and remove the prose. Allowlist a specific line by prefixing with `// CHARTER: keep` (or `<!-- CHARTER: keep -->` in markdown).",
              issues,
            },
          }
        : {}),
    },
  ]),
  { json: values.json },
);
