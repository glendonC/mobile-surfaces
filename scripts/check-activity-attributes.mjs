#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const modulePath = path.resolve(
  "apps/mobile/modules/live-activity/ios/MobileSurfacesActivityAttributes.swift",
);
const widgetPath = path.resolve(
  "apps/mobile/targets/widget/MobileSurfacesActivityAttributes.swift",
);

const moduleSource = fs.readFileSync(modulePath, "utf8");
const widgetSource = fs.readFileSync(widgetPath, "utf8");

if (moduleSource !== widgetSource) {
  console.error("ActivityKit attribute definitions have drifted.");
  console.error(`Expected byte-identical files:\n- ${modulePath}\n- ${widgetPath}`);
  process.exit(1);
}

console.log("ActivityKit attribute definitions are byte-identical.");
