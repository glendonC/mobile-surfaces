import test from "node:test";
import assert from "node:assert/strict";

import {
  computeCatalogStats,
  markerValues,
  applyCatalogMarkers,
} from "./lib/catalog-stats.mjs";

const sampleCatalog = {
  entries: [
    { id: "MS001", severity: "error", detection: "static", category: "ios-trap" },
    { id: "MS002", severity: "error", detection: "config", category: "wire-trap" },
    { id: "MS003", severity: "warning", detection: "config", category: "ios-trap" },
    { id: "MS004", severity: "info", detection: "advisory", category: "maintenance" },
    { id: "MS005", severity: "error", detection: "runtime", category: "wire-trap" },
    { id: "MS006", severity: "info", detection: "advisory", category: "maintenance", deprecated: true },
  ],
};

const sampleRegistry = [
  { id: "a", stage: 3, trapIds: ["MS001"] },
  { id: "b", stage: 4, trapIds: ["MS002"] },
  // stage 0 is diagnose-only: its trap must NOT count as PR-gated.
  { id: "c", stage: 0, trapIds: ["MS003"] },
  // a trap bound by two registry entries counts once.
  { id: "d", stage: 2, trapIds: ["MS001"] },
];

test("computeCatalogStats counts live, deprecated, severity, detection, category", () => {
  const stats = computeCatalogStats(sampleCatalog);
  assert.equal(stats.total, 6);
  assert.equal(stats.live, 5);
  assert.equal(stats.deprecated, 1);
  assert.deepEqual(stats.bySeverity, { error: 3, warning: 1, info: 1 });
  assert.deepEqual(stats.byDetection, {
    static: 1,
    config: 2,
    runtime: 1,
    advisory: 1,
  });
  assert.deepEqual(stats.byCategory, {
    "ios-trap": 2,
    "wire-trap": 2,
    maintenance: 1,
  });
  assert.equal(stats.userFacing, 4);
});

test("computeCatalogStats omits prGated when no registry is supplied", () => {
  const stats = computeCatalogStats(sampleCatalog);
  assert.equal("prGated" in stats, false);
});

test("prGated counts stage>=1 bindings, dedups, and excludes stage 0", () => {
  const stats = computeCatalogStats(sampleCatalog, sampleRegistry);
  // MS001 (bound twice, counts once) + MS002. MS003 is stage 0, excluded.
  assert.equal(stats.prGated, 2);
});

test("prGated ignores a registry id that is not a live trap", () => {
  const stats = computeCatalogStats(sampleCatalog, [
    { id: "x", stage: 3, trapIds: ["MS006"] }, // MS006 is deprecated
    { id: "y", stage: 3, trapIds: ["MS999"] }, // not in the catalog
  ]);
  assert.equal(stats.prGated, 0);
});

test("markerValues derives runtime, remainder, and the category split", () => {
  const stats = computeCatalogStats(sampleCatalog, sampleRegistry);
  const values = markerValues(stats);
  // live 5, prGated 2, runtime 1, remainder = 5 - 2 - 1 = 2.
  // userFacing = ios-trap (2) + wire-trap (2) = 4; maintenance = 1.
  assert.deepEqual(values, {
    live: "5",
    prGated: "2",
    runtime: "1",
    remainder: "2",
    iosTraps: "2",
    wireTraps: "2",
    maintenance: "1",
    userFacing: "4",
  });
});

test("markerValues requires prGated", () => {
  assert.throws(
    () => markerValues(computeCatalogStats(sampleCatalog)),
    /requires stats\.prGated/,
  );
});

test("applyCatalogMarkers replaces content between marker pairs", () => {
  const content =
    "rules: <!-- catalog-stats:live -->1<!-- /catalog-stats:live --> total.";
  const out = applyCatalogMarkers(content, ["live"], { live: "40" });
  assert.equal(
    out,
    "rules: <!-- catalog-stats:live -->40<!-- /catalog-stats:live --> total.",
  );
});

test("applyCatalogMarkers throws on a missing marker", () => {
  assert.throws(
    () => applyCatalogMarkers("no markers here", ["live"], { live: "40" }),
    /marker block "catalog-stats:live" not found/,
  );
});

test("applyCatalogMarkers leaves prose outside markers untouched", () => {
  const content =
    "<!-- catalog-stats:live -->9<!-- /catalog-stats:live --> rules, hand-written note.";
  const out = applyCatalogMarkers(content, ["live"], { live: "40" });
  assert.equal(out.includes("hand-written note."), true);
});
