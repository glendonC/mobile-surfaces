import test from "node:test";
import assert from "node:assert/strict";
import { toCamelKey, detectCollisions } from "./generate-surface-fixtures.mjs";

test("toCamelKey passes through a simple key", () => {
  assert.equal(toCamelKey("queued"), "queued");
});

test("toCamelKey camelCases hyphenated names", () => {
  assert.equal(toCamelKey("active-progress"), "activeProgress");
});

test("toCamelKey is a no-op on already-camelCased input (collision case)", () => {
  // Same output as the hyphenated form above: this is exactly the silent
  // shadowing detectCollisions exists to flag.
  assert.equal(toCamelKey("activeProgress"), "activeProgress");
});

test("detectCollisions returns empty for distinct keys", () => {
  const collisions = detectCollisions([
    "./queued.json",
    "./attention.json",
    "./active-progress.json",
  ]);
  assert.deepEqual(collisions, []);
});

test("detectCollisions reports the colliding pair when both forms are passed", () => {
  const collisions = detectCollisions([
    "./active-progress.json",
    "./activeProgress.json",
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].key, "activeProgress");
  assert.deepEqual(collisions[0].files, ["active-progress", "activeProgress"]);
});
