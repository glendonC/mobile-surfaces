#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const fixtureDir = path.resolve("data/surface-fixtures");
const indexPath = path.join(fixtureDir, "index.json");
const schemaPath = path.resolve("packages/surface-contracts/schema.json");
const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const requiredString = schema.requiredStringFields;
const validStages = new Set(schema.liveSurfaceStages);
const validStates = new Set(schema.liveSurfaceStates);

const errors = [];
for (const entry of entries) {
  const file = path.resolve(fixtureDir, entry);
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const label = path.relative(process.cwd(), file);

  for (const key of requiredString) {
    if (typeof fixture[key] !== "string" || fixture[key].length === 0) {
      errors.push(`${label}: ${key} must be a non-empty string`);
    }
  }
  if (!validStates.has(fixture.state)) {
    errors.push(`${label}: state is not a known live surface state`);
  }
  if (!validStages.has(fixture.stage)) {
    errors.push(`${label}: stage must be prompted, inProgress, or completing`);
  }
  if (typeof fixture.progress !== "number" || fixture.progress < 0 || fixture.progress > 1) {
    errors.push(`${label}: progress must be a number from 0 to 1`);
  }
  if (!Number.isInteger(fixture.estimatedSeconds) || fixture.estimatedSeconds < 0) {
    errors.push(`${label}: estimatedSeconds must be a non-negative integer`);
  }
  if (!Number.isInteger(fixture.morePartsCount) || fixture.morePartsCount < 0) {
    errors.push(`${label}: morePartsCount must be a non-negative integer`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${entries.length} surface fixtures.`);
