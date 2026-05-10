// Workspace detection. Returns { kind, path?, globs } when cwd looks like a
// pnpm-workspace.yaml or package.json `workspaces` workspace, or null. Pulled
// out of mode.mjs so callers that need just the workspace shape (or want to
// unit-test the YAML parser) don't pay the cost of mode detection's wider
// filesystem walk.

import fs from "node:fs";
import path from "node:path";

export function detectWorkspace({ cwd, pkg }) {
  const pnpmYaml = path.join(cwd, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmYaml)) {
    return {
      kind: "pnpm-workspace",
      path: pnpmYaml,
      globs: parsePnpmWorkspaceGlobs(fs.readFileSync(pnpmYaml, "utf8")),
    };
  }
  if (Array.isArray(pkg.workspaces)) {
    return { kind: "package-json", path: null, globs: [...pkg.workspaces] };
  }
  if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
    return {
      kind: "package-json",
      path: null,
      globs: [...pkg.workspaces.packages],
    };
  }
  return null;
}

// Tiny YAML reader scoped to the shape pnpm-workspace.yaml uses (a top-level
// `packages:` key with a list of quoted strings). Avoids pulling in a YAML
// dep for a parse this constrained.
export function parsePnpmWorkspaceGlobs(yaml) {
  const lines = yaml.split(/\r?\n/);
  const globs = [];
  let inPackages = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "");
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = line.match(/^\s+-\s*['"]?([^'"]+?)['"]?\s*$/);
      if (m) {
        globs.push(m[1]);
        continue;
      }
      // A non-list, non-blank line at column 0 ends the packages block.
      if (line.trim() && !/^\s/.test(line)) inPackages = false;
    }
  }
  return globs;
}
