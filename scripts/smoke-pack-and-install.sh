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
