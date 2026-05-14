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

// One probe, cached for the life of the process. resolveTemplateRoot() and
// scaffold.mjs's resolveTemplateSource() both ask the same question — is
// this a published tarball or a live monorepo — so cache the answer in a
// shape that carries every path either caller needs.
//
// The default probe prefers the bundled template/manifest.json when it
// exists on disk, else falls back to the live monorepo. Those bundled
// files are gitignored build outputs (scripts/build-template.mjs writes
// them), so whether they exist is purely a function of local history: a
// fresh CI checkout has none, a developer who ever ran build:template has
// stale ones. Anything that probes the mode therefore gets a different
// answer in CI vs. locally: silent and environment-dependent.
//
// MOBILE_SURFACES_CLI_MODE pins the answer explicitly, bypassing the disk
// probe entirely. The scaffold snapshot test sets it to "live" so it
// always runs from the monorepo source regardless of whether stale
// bundled artifacts happen to be on disk. Valid values: "live", "bundled".
let _cliMode;
function resolveCliMode() {
  if (_cliMode) return _cliMode;
  const templateDir = path.resolve(__dirname, "..", "template");
  const manifestPath = path.join(templateDir, "manifest.json");
  const tarballPath = path.join(templateDir, "template.tgz");
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  const forced = process.env.MOBILE_SURFACES_CLI_MODE;
  if (forced === "live") {
    if (!fs.existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
      throw new Error(
        `MOBILE_SURFACES_CLI_MODE=live but no monorepo found at ${repoRoot}.`,
      );
    }
    _cliMode = { kind: "live", repoRoot };
    return _cliMode;
  }
  if (forced === "bundled") {
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `MOBILE_SURFACES_CLI_MODE=bundled but no bundled template at ${manifestPath}. Run build:template first.`,
      );
    }
    _cliMode = { kind: "bundled", manifestPath, tarballPath };
    return _cliMode;
  }
  if (forced !== undefined && forced !== "") {
    throw new Error(
      `MOBILE_SURFACES_CLI_MODE must be "live" or "bundled", got "${forced}".`,
    );
  }

  if (fs.existsSync(manifestPath)) {
    _cliMode = { kind: "bundled", manifestPath, tarballPath };
    return _cliMode;
  }
  if (fs.existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
    _cliMode = { kind: "live", repoRoot };
    return _cliMode;
  }
  throw new Error(
    `Couldn't locate the template. Looked for ${manifestPath} (published) or a monorepo at ${repoRoot} (dev).`,
  );
}

export function resolveTemplateRoot() {
  const mode = resolveCliMode();
  return mode.kind === "bundled"
    ? { kind: "bundled", manifestPath: mode.manifestPath }
    : { kind: "live", repoRoot: mode.repoRoot };
}

// Used by scaffold.mjs; exposes the tarball path when published, or the
// monorepo root when live. Shares the same cached probe as resolveTemplateRoot.
export function resolveTemplateTarball() {
  const mode = resolveCliMode();
  return mode.kind === "bundled"
    ? { kind: "tarball", path: mode.tarballPath }
    : { kind: "git", path: mode.repoRoot };
}

export function loadTemplateManifest() {
  const source = resolveTemplateRoot();
  if (source.kind === "bundled") {
    return JSON.parse(fs.readFileSync(source.manifestPath, "utf8"));
  }
  return buildManifestFromLive(source.repoRoot);
}

// Cache the live manifest by repoRoot so retries (e.g. failed scaffold then
// rerun in the same process, dev-smoke scripts that read the manifest twice)
// don't re-parse the 3–4 source files. Keyed by repoRoot so a test that
// switches roots in-process still gets a fresh read.
const _liveManifestCache = new Map();

// Used by the publish-time builder so the bundled manifest snapshot has the
// exact same shape as a live read.
export function buildManifestFromLive(repoRoot) {
  const cached = _liveManifestCache.get(repoRoot);
  if (cached) return cached;
  const manifest = computeLiveManifest(repoRoot);
  _liveManifestCache.set(repoRoot, manifest);
  return manifest;
}

function computeLiveManifest(repoRoot) {
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
  // in apps/mobile/package.json. @mobile-surfaces/* packages are declared as
  // workspace:* in the live repo but ship to npm under a linked release group;
  // resolve those workspace refs to the concrete published version recorded
  // in packages/<short-name>/package.json so foreign installs get a real
  // npm-resolvable spec. Non-@mobile-surfaces local refs (file:, foreign
  // workspace:*) stay marked workspace so the install step skips them.
  const addPackages = (ms.addPackages ?? []).map((name) => {
    const declared = allAppDeps[name];
    if (declared) {
      const isLocal = declared.startsWith("workspace:") || declared.startsWith("file:");
      if (!isLocal) return { name, version: declared };
      const resolved = resolvePublishedMobileSurfacesVersion(repoRoot, name);
      if (resolved) return { name, version: resolved };
      return { name, version: declared, workspace: true };
    }
    const resolved = resolvePublishedMobileSurfacesVersion(repoRoot, name);
    if (resolved) return { name, version: resolved };
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

  // Entitlements: App Groups must be present on both the host app and the
  // widget extension for shared UserDefaults state to work.
  const entitlementsSource = expo.ios?.entitlements ?? {};
  const addEntitlements = {};
  for (const key of ms.addEntitlementKeys ?? []) {
    if (key in entitlementsSource) {
      addEntitlements[key] = entitlementsSource[key];
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
    addEntitlements,
    widgetTargetDir: widgetDirRel,
    widgetFiles,
  };
}

// Look up the version of a @mobile-surfaces/* package from its own
// package.json under packages/. Returns null for names outside the scope
// or when the package directory is missing. The linked changeset group
// keeps these versions in lockstep, so reading one is enough to pin a
// foreign install to a coherent set.
function resolvePublishedMobileSurfacesVersion(repoRoot, name) {
  if (!name.startsWith("@mobile-surfaces/")) return null;
  const shortName = name.slice("@mobile-surfaces/".length);
  const pkgPath = path.join(repoRoot, "packages", shortName, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return typeof pkg.version === "string" && pkg.version.length > 0
    ? pkg.version
    : null;
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
