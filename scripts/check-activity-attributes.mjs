#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const moduleDir = path.resolve("packages/live-activity/ios");
const widgetDir = path.resolve("apps/mobile/targets/widget");

const modulePath = findAttributesFile(moduleDir);
const widgetPath = findAttributesFile(widgetDir);

if (path.basename(modulePath) !== path.basename(widgetPath)) {
  console.error(
    `ActivityKit attribute filenames differ:\n- ${modulePath}\n- ${widgetPath}`,
  );
  process.exit(1);
}

const moduleSource = fs.readFileSync(modulePath, "utf8");
const widgetSource = fs.readFileSync(widgetPath, "utf8");

if (moduleSource !== widgetSource) {
  console.error("ActivityKit attribute definitions have drifted.");
  console.error(`Expected byte-identical files:\n- ${modulePath}\n- ${widgetPath}`);
  process.exit(1);
}

console.log("ActivityKit attribute definitions are byte-identical.");

function findAttributesFile(dir) {
  const matches = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("ActivityAttributes.swift"))
    .map((f) => path.join(dir, f));
  if (matches.length === 0) {
    console.error(`No *ActivityAttributes.swift found in ${dir}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Multiple *ActivityAttributes.swift in ${dir}:\n  ${matches.join("\n  ")}`);
    process.exit(1);
  }
  return matches[0];
}
