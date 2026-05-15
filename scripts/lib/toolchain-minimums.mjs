// Single source of truth for repo-time toolchain minimums (Node major, Xcode
// major). Reads the `mobileSurfaces` block from the root package.json so the
// numbers live in exactly one place. Used by scripts/doctor.mjs.
//
// Note: this is distinct from the scaffold-time minimums consumed by
// packages/create-mobile-surfaces. The CLI bakes those into its template
// manifest at build time (also sourced from this same root package.json via
// template-manifest.mjs). The two paths converge on one file but represent
// two different lifecycles: REPO-time = required to build the monorepo;
// SCAFFOLD-time = required to build a project generated from the template.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_PACKAGE_JSON = resolve(HERE, "..", "..", "package.json");

/**
 * Load toolchain minimums from the root package.json `mobileSurfaces` block.
 * Returns { node, xcode } where each entry is an integer major version, or
 * null when the field is absent. Callers decide how to handle a null (today
 * doctor.mjs hard-codes a sensible fallback message).
 *
 * @param {string} [pkgPath]  Override path for tests.
 */
export function loadToolchainMinimums(pkgPath = ROOT_PACKAGE_JSON) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (error) {
    throw new Error(
      `loadToolchainMinimums: failed to read ${pkgPath}: ${error?.message ?? error}`,
    );
  }
  const ms = pkg?.mobileSurfaces ?? {};
  return {
    node: typeof ms.minimumNodeMajor === "number" ? ms.minimumNodeMajor : null,
    xcode: typeof ms.minimumXcodeMajor === "number" ? ms.minimumXcodeMajor : null,
  };
}
