// @ts-check
//
// Canonical catalog-statistics computation. Every public count of trap-catalog
// rules derives from here: the AGENTS.md / CLAUDE.md headline
// (scripts/build-agents-md.mjs) and the README + doc-site marker blocks
// (scripts/generate-catalog-stats.mjs) both call computeCatalogStats, so the
// two surfaces cannot drift from each other or from data/traps.json.
//
// Before this module existed, build-agents-md counted rules inline and the
// doc-site numbers were hand-maintained prose; the prose went stale every
// time a rule was added or reclassified. One shared function closes that gap.

/**
 * @typedef {Object} CatalogStats
 * @property {number} total       Every entry in the catalog, live + retired.
 * @property {number} live        Entries without `deprecated: true`.
 * @property {number} deprecated  Retired ids kept as tombstones.
 * @property {{ error:number, warning:number, info:number }} bySeverity
 *   Live entries grouped by severity.
 * @property {{ static:number, config:number, runtime:number, advisory:number }} byDetection
 *   Live entries grouped by detection.
 * @property {{ "ios-trap":number, "wire-trap":number, "maintenance":number }} byCategory
 *   Live entries grouped by category. `ios-trap` and `wire-trap` together are
 *   the user-facing total; `maintenance` is the repo-internal hygiene count.
 * @property {number} userFacing
 *   Convenience: `byCategory["ios-trap"] + byCategory["wire-trap"]`.
 * @property {number} [prGated]
 *   Live rules bound to a check that runs in surface:check (registry stage
 *   >= 1). Present only when a registry is supplied.
 */

/**
 * Compute the canonical catalog breakdown.
 *
 * @param {{ entries: ReadonlyArray<{ id:string, severity:string, detection:string, category:string, deprecated?:boolean }> }} catalog
 *   Parsed data/traps.json.
 * @param {ReadonlyArray<{ stage:number, trapIds?:ReadonlyArray<string> }>} [registry]
 *   scripts/lib/check-registry.mjs checkRegistry. When supplied, `prGated` is
 *   computed; when omitted it is left off the result (the AGENTS.md headline
 *   does not need it, so build-agents-md calls without a registry).
 * @returns {CatalogStats}
 */
export function computeCatalogStats(catalog, registry) {
  const entries = catalog.entries;
  const live = entries.filter((e) => !e.deprecated);
  const deprecated = entries.filter((e) => e.deprecated);

  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byDetection = { static: 0, config: 0, runtime: 0, advisory: 0 };
  const byCategory = { "ios-trap": 0, "wire-trap": 0, maintenance: 0 };
  for (const e of live) {
    bySeverity[e.severity] += 1;
    byDetection[e.detection] += 1;
    byCategory[e.category] += 1;
  }

  /** @type {CatalogStats} */
  const stats = {
    total: entries.length,
    live: live.length,
    deprecated: deprecated.length,
    bySeverity,
    byDetection,
    byCategory,
    userFacing: byCategory["ios-trap"] + byCategory["wire-trap"],
  };

  if (registry) {
    // A live rule is "PR-gated" when its id is bound to a registry check that
    // runs in surface:check, i.e. stage >= 1. Stage-0 entries are
    // diagnose-only and never fail a build, so MS010 (toolchain preflight,
    // bound to `doctor` at stage 0) is correctly excluded. A trap counts once
    // even if more than one registry entry binds it.
    const liveIds = new Set(live.map((e) => e.id));
    const prGated = new Set();
    for (const entry of registry) {
      if (entry.stage < 1) continue;
      for (const id of entry.trapIds ?? []) {
        if (liveIds.has(id)) prGated.add(id);
      }
    }
    stats.prGated = prGated.size;
  }

  return stats;
}

/**
 * Derive the values consumed by the `catalog-stats:` doc marker blocks. Every
 * value is a string (markers carry rendered text). `remainder` is the live
 * rules that are neither PR-gated nor runtime-detected: advisory rules plus
 * the toolchain preflight. `iosTraps`, `wireTraps`, `maintenance`, and
 * `userFacing` surface the category split so the README and site can render
 * "N user-facing + M maintenance" instead of conflating the two.
 *
 * @param {CatalogStats} stats  Must include `prGated` (pass a registry to computeCatalogStats).
 * @returns {{ live:string, prGated:string, runtime:string, remainder:string, iosTraps:string, wireTraps:string, maintenance:string, userFacing:string }}
 */
export function markerValues(stats) {
  if (typeof stats.prGated !== "number") {
    throw new Error(
      "markerValues requires stats.prGated; call computeCatalogStats with a registry.",
    );
  }
  const runtime = stats.byDetection.runtime;
  return {
    live: String(stats.live),
    prGated: String(stats.prGated),
    runtime: String(runtime),
    remainder: String(stats.live - stats.prGated - runtime),
    iosTraps: String(stats.byCategory["ios-trap"]),
    wireTraps: String(stats.byCategory["wire-trap"]),
    maintenance: String(stats.byCategory.maintenance),
    userFacing: String(stats.userFacing),
  };
}

/**
 * Rewrite `<!-- catalog-stats:KEY -->...<!-- /catalog-stats:KEY -->` marker
 * blocks in a document, replacing the content between each open/close pair
 * with its value. A requested key whose marker pair is absent is a hard
 * error: a silently-skipped marker would let a stale number survive.
 *
 * @param {string} content   Current file text.
 * @param {ReadonlyArray<string>} keys  Marker keys expected in this file.
 * @param {Record<string,string>} valuesMap  Key -> replacement text.
 * @param {string} [label]   File label for error messages.
 * @returns {string} The rewritten content.
 */
export function applyCatalogMarkers(content, keys, valuesMap, label = "file") {
  let out = content;
  for (const key of keys) {
    const re = new RegExp(
      `(<!--\\s*catalog-stats:${key}\\s*-->)[\\s\\S]*?(<!--\\s*/catalog-stats:${key}\\s*-->)`,
    );
    if (!re.test(out)) {
      throw new Error(
        `${label}: marker block "catalog-stats:${key}" not found. ` +
          `Wrap the number in <!-- catalog-stats:${key} -->N<!-- /catalog-stats:${key} -->.`,
      );
    }
    out = out.replace(re, `$1${valuesMap[key]}$2`);
  }
  return out;
}
