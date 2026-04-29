// The template is the source of truth for what Mobile Surfaces is. The CLI
// reads a manifest from the template at runtime instead of holding its own
// opinions about which packages, plugins, or Info.plist keys to install.
// When the template evolves, the CLI follows automatically — no sync code,
// no drift.
//
// The manifest is built one of two ways:
//   • In dev (running from the monorepo): read the live repo files directly.
//   • In a published tarball: read a pre-baked template/manifest.json that
//     scripts/build-template.mjs snapshotted at publish time.
//
// Both paths produce the same shape so callers don't care which mode they're in.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveTemplateRoot() {
  // Published: a manifest.json lives next to the bundled tarball.
  const bundled = path.resolve(__dirname, "..", "template", "manifest.json");
  if (fs.existsSync(bundled)) {
    return { kind: "bundled", manifestPath: bundled };
  }
  // Dev: walk up to the monorepo root and read live files.
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  if (fs.existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
    return { kind: "live", repoRoot };
  }
  throw new Error(
    `Couldn't locate the template. Looked for ${bundled} (published) or a monorepo at ${repoRoot} (dev).`,
  );
}

export function loadTemplateManifest() {
  const source = resolveTemplateRoot();
  if (source.kind === "bundled") {
    return JSON.parse(fs.readFileSync(source.manifestPath, "utf8"));
  }
  return buildManifestFromLive(source.repoRoot);
}

// Used by the publish-time builder so the bundled manifest snapshot has the
// exact same shape as a live read.
export function buildManifestFromLive(repoRoot) {
  const rootPkgPath = path.join(repoRoot, "package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  const ms = rootPkg.mobileSurfaces ?? {};

  const appJsonPath = path.join(repoRoot, "apps", "mobile", "app.json");
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  const expo = appJson.expo ?? {};

  const appPkgPath = path.join(repoRoot, "apps", "mobile", "package.json");
  const appPkg = JSON.parse(fs.readFileSync(appPkgPath, "utf8"));
  const allAppDeps = { ...appPkg.dependencies, ...appPkg.devDependencies };

  // Resolve packages we'd add — for each declared addition, find the version
  // in apps/mobile/package.json. Workspace packages (workspace:* protocol)
  // and file: deps can't be installed from npm yet, so they get a marker so
  // the install step can skip them and surface a follow-up.
  const addPackages = (ms.addPackages ?? []).map((name) => {
    const declared = allAppDeps[name];
    if (declared) {
      const isLocal = declared.startsWith("workspace:") || declared.startsWith("file:");
      if (isLocal) return { name, version: declared, workspace: true };
      return { name, version: declared };
    }
    if (name.startsWith("@mobile-surfaces/")) {
      return { name, version: "workspace", workspace: true };
    }
    return { name, version: "latest" };
  });

  // Plugins: keep both the bare name and any per-plugin config from the live
  // app.json so the merger can replicate the same settings (e.g. the
  // `expo-build-properties` block that pins the iOS deployment target).
  const livePlugins = expo.plugins ?? [];
  const pluginConfigByName = new Map();
  for (const entry of livePlugins) {
    if (Array.isArray(entry)) {
      pluginConfigByName.set(entry[0], entry[1]);
    } else {
      pluginConfigByName.set(entry, undefined);
    }
  }
  const addPlugins = (ms.addPlugins ?? []).map((name) => {
    const config = pluginConfigByName.get(name);
    return config === undefined ? { name } : { name, config };
  });

  // Info.plist keys: pull values from the live app.json for each declared key.
  const infoPlistSource = expo.ios?.infoPlist ?? {};
  const addInfoPlist = {};
  for (const key of ms.addInfoPlistKeys ?? []) {
    if (key in infoPlistSource) {
      addInfoPlist[key] = infoPlistSource[key];
    }
  }

  // Widget target files: list whatever's in the declared dir.
  const widgetDirRel = ms.widgetTargetDir ?? "apps/mobile/targets/widget";
  const widgetDirAbs = path.join(repoRoot, widgetDirRel);
  const widgetFiles = fs.existsSync(widgetDirAbs)
    ? fs.readdirSync(widgetDirAbs).map((f) => path.posix.join(widgetDirRel, f))
    : [];

  return {
    cliRequiredNode: rootPkg.engines?.node ?? null,
    deploymentTarget: expo.ios?.deploymentTarget ?? null,
    minimumXcodeMajor: ms.minimumXcodeMajor ?? null,
    addPackages,
    addPlugins,
    addInfoPlist,
    widgetTargetDir: widgetDirRel,
    widgetFiles,
  };
}

// Read this CLI's own version from its package.json (no hardcoding).
let _cliVersion;
export function getCliVersion() {
  if (_cliVersion) return _cliVersion;
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"),
  );
  _cliVersion = pkg.version;
  return _cliVersion;
}
