#!/usr/bin/env bash
set -euo pipefail

# Pack-and-install smoke for create-mobile-surfaces. Catches publish-time
# breakage that no other test surfaces:
#   - missing entries in `files:` (tar -tzf assertions)
#   - missing template/template.tgz (because pnpm pack does NOT run
#     prepublishOnly, easy to break and silent until a downstream install)
#   - shebang/permission breakage on bin/index.mjs (--help invocation)
#   - accidental dependency on workspace-only packages (npm install from
#     tarball alone)
#   - broken flag-parsing path through the published binary (--yes without
#     --name expects USER_ERROR by the #36 ordering)
#
# Deliberately does NOT run the binary all the way through to a real
# scaffold: that would require preflight to pass, which needs Xcode 26+ and
# iOS 17.2 simulators on the runner. macos-latest currently ships Xcode
# 16.4. Full scaffold extraction is exercised by cli:test against in-process
# internals; this smoke covers the tarball boundary, where in-process tests
# can't see.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR"' EXIT

(
  cd "$REPO_ROOT/packages/create-mobile-surfaces"
  pnpm build:template
  # cd into the package rather than using `--filter` because pnpm's filter
  # flag implies recursive execution, and `pack` is a single-package command
  # that rejects --recursive in pnpm 10.
  pnpm pack --pack-destination "$PACK_DIR"
)
TARBALL="$(echo "$PACK_DIR"/create-mobile-surfaces-*.tgz)"

# Phase 1: tarball contents. Each entry in package.json `files:` should be
# represented; a typo dropping any of bin/, src/, or template/ ships a
# broken package.
#
# Materialize once and grep against the buffer. Piping tar straight into
# `grep -q` looks fine locally but under `set -euo pipefail` it races: grep
# closes the pipe on first match, tar gets SIGPIPE mid-write, and the
# pipeline exits non-zero. Hit on the first publish run on CI; the local
# tarball was small enough that tar finished before grep closed.
TARBALL_ENTRIES="$(tar -tzf "$TARBALL")"
grep -qx 'package/bin/index.mjs' <<<"$TARBALL_ENTRIES"
grep -qx 'package/template/template.tgz' <<<"$TARBALL_ENTRIES"
grep -qx 'package/template/manifest.json' <<<"$TARBALL_ENTRIES"
grep -q '^package/src/' <<<"$TARBALL_ENTRIES"

# Phase 2: install + invoke via the published bin path.
INSTALL_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR" "$INSTALL_DIR"' EXIT
cd "$INSTALL_DIR"
npm init -y >/dev/null

# Workspace deps inside the tarball point at versions that aren't on npm yet
# during a release (the linked group bumps everything to the same new version
# before any of those versions actually publish). Without this, npm install
# 404s on the freshly-bumped sibling package and the smoke step blocks the
# very publish that would make it pass.
#
# Scan the tarball's package.json for any @mobile-surfaces/* dep and pin it
# to a `file:` reference into the local workspace via npm `overrides`. The
# spirit of the original check still holds: a tarball that depended on a
# package not present in the workspace would also fail (no `file:` path to
# point at), and the test's other phases (tarball-contents, --help, --yes
# exit code) are untouched.
node -e '
  const fs = require("node:fs");
  const { execSync } = require("node:child_process");
  const repoRoot = process.argv[1];
  const tarballPath = process.argv[2];
  const pkgJsonRaw = execSync(`tar -xzOf "${tarballPath}" package/package.json`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  const pkg = JSON.parse(pkgJsonRaw);
  const overrides = {};
  for (const section of ["dependencies", "peerDependencies"]) {
    for (const name of Object.keys(pkg[section] || {})) {
      if (!name.startsWith("@mobile-surfaces/")) continue;
      const local = name.replace(/^@mobile-surfaces\//, "");
      const localPath = `${repoRoot}/packages/${local}`;
      if (!fs.existsSync(`${localPath}/package.json`)) {
        console.error(`tarball depends on ${name} but ${localPath} not found in workspace`);
        process.exit(1);
      }
      overrides[name] = `file:${localPath}`;
    }
  }
  const current = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (Object.keys(overrides).length > 0) {
    current.overrides = overrides;
    console.log(`Pinned ${Object.keys(overrides).length} workspace dep(s) to local paths.`);
  }
  fs.writeFileSync("package.json", JSON.stringify(current, null, 2));
' "$REPO_ROOT" "$TARBALL"

npm install "$TARBALL"
BIN=./node_modules/.bin/create-mobile-surfaces

# --help exits 0 before any preflight or detection.
"$BIN" --help >/dev/null

# --yes without --name exits 1 (USER_ERROR) before preflight, by the
# ordering established in #36. Verifies resolveYesConfig fires through the
# published binary.
set +e
"$BIN" --yes >/dev/null 2>&1
EXIT=$?
set -e
if [ "$EXIT" != "1" ]; then
  echo "expected --yes to exit 1, got $EXIT"
  exit 1
fi
