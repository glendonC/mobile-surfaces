#!/usr/bin/env bash
set -euo pipefail

use_node_24_if_available() {
  local candidate

  if command -v brew >/dev/null 2>&1; then
    candidate="$(brew --prefix node@24 2>/dev/null || true)"
    if [[ -x "$candidate/bin/node" ]]; then
      export PATH="$candidate/bin:$PATH"
      return
    fi
  fi

  for candidate in /opt/homebrew/opt/node@24 /usr/local/opt/node@24; do
    if [[ -x "$candidate/bin/node" ]]; then
      export PATH="$candidate/bin:$PATH"
      return
    fi
  done
}

if ! command -v node >/dev/null 2>&1; then
  use_node_24_if_available
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
NODE_MAJOR="${NODE_VERSION%%.*}"

if [[ "$NODE_MAJOR" != "24" ]]; then
  use_node_24_if_available
  NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
  NODE_MAJOR="${NODE_VERSION%%.*}"
fi

if [[ "$NODE_MAJOR" != "24" ]]; then
  echo "Expected Node 24.x, but found Node ${NODE_VERSION:-unknown} at $(command -v node)."
  echo
  echo "Use your preferred version manager to switch to Node 24:"
  echo "  nvm install 24 && nvm use"
  echo "  mise use node@24"
  echo "  fnm install 24 && fnm use 24"
  echo "  brew install node@24 && export PATH=\"/opt/homebrew/opt/node@24/bin:\$PATH\""
  exit 1
fi
