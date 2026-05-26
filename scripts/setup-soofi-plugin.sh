#!/usr/bin/env bash
# Install or update soofi-xyz-team-kit as a Cursor local plugin.
# Run: pnpm setup-soofi-plugin
set -euo pipefail

PLUGIN_DIR="${HOME}/.cursor/plugins/local/soofi-xyz"
REPO_URL="https://github.com/soofi-xyz/soofi-xyz-team-kit.git"
LOCK_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/external/soofi-team-kit.lock"

echo "=== soofi team-kit plugin setup ==="
echo ""

if [ -d "${PLUGIN_DIR}/.git" ]; then
  echo "Updating existing plugin at ${PLUGIN_DIR} ..."
  git -C "${PLUGIN_DIR}" pull --ff-only
else
  echo "Cloning team-kit to ${PLUGIN_DIR} ..."
  mkdir -p "$(dirname "${PLUGIN_DIR}")"
  git clone "${REPO_URL}" "${PLUGIN_DIR}"
fi

HEAD_SHA=$(git -C "${PLUGIN_DIR}" rev-parse HEAD)
echo ""
echo "Installed commit: ${HEAD_SHA}"
echo ""
echo ">>> Next steps:"
echo "    1. Update 'testedCommit' in external/soofi-team-kit.lock to: ${HEAD_SHA}"
echo "    2. Restart Cursor (Cmd+Shift+P → 'Reload Window' or quit and reopen)"
echo "    3. Verify: @arceus and @slowking both appear in the Cursor agent picker"
echo "    4. Run: pnpm verify-soofi-plugin"
echo ""
echo "Lock file reference: ${LOCK_FILE}"
