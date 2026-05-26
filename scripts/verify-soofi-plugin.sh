#!/usr/bin/env bash
# Assert that soofi-xyz-team-kit is installed as a Cursor local plugin.
# Run: pnpm verify-soofi-plugin
set -euo pipefail

PLUGIN_DIR="${HOME}/.cursor/plugins/local/soofi-xyz"
LOCK_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/external/soofi-team-kit.lock"
FAILED=0

pass() { echo "  ✅  $1"; }
fail() { echo "  ❌  $1"; FAILED=1; }
warn() { echo "  ⚠️   $1"; }

echo ""
echo "=== soofi team-kit plugin verify ==="
echo ""

# 1. Plugin directory exists
if [ -d "${PLUGIN_DIR}" ]; then
  pass "Plugin dir exists: ${PLUGIN_DIR}"
else
  fail "Plugin dir not found: ${PLUGIN_DIR} — run: pnpm setup-soofi-plugin"
  exit 1
fi

# 2. Required top-level files
for f in "README.md" "AGENTS.md"; do
  if [ -f "${PLUGIN_DIR}/${f}" ]; then
    pass "${f} present"
  else
    fail "${f} missing at ${PLUGIN_DIR}/${f}"
  fi
done

# 3. Plugin manifest (check both locations)
if [ -f "${PLUGIN_DIR}/.cursor-plugin/plugin.json" ]; then
  pass ".cursor-plugin/plugin.json present"
elif [ -f "${PLUGIN_DIR}/plugin.json" ]; then
  pass "plugin.json present (root)"
else
  fail "No plugin.json found at .cursor-plugin/plugin.json or plugin.json"
fi

# 4. Required agents
echo ""
echo "  Checking agents..."
REQUIRED_AGENTS=(arceus ash espeon alakazam chatot xatu oranguru conkeldurr)
for agent in "${REQUIRED_AGENTS[@]}"; do
  if [ -f "${PLUGIN_DIR}/agents/${agent}.md" ]; then
    pass "agents/${agent}.md"
  else
    fail "agents/${agent}.md missing"
  fi
done

# 5. Required skills
echo ""
echo "  Checking skills..."
REQUIRED_SKILLS=(
  apply-engineering-guidelines
  build-ai-agents
  build-local-rag-pocs
  build-rag-systems
  manage-communication-activity
  assemble-communication-runtime
  select-communication-audience
)
for skill in "${REQUIRED_SKILLS[@]}"; do
  if [ -d "${PLUGIN_DIR}/skills/${skill}" ]; then
    pass "skills/${skill}/"
  else
    fail "skills/${skill}/ missing"
  fi
done

# 6. Commit drift check (optional warn)
echo ""
if [ -f "${LOCK_FILE}" ]; then
  TESTED_COMMIT=$(python3 -c "import json,sys; d=json.load(open('${LOCK_FILE}')); print(d.get('testedCommit',''))" 2>/dev/null || echo "")
  if [ -n "${TESTED_COMMIT}" ] && [ "${TESTED_COMMIT}" != "TO_BE_FILLED" ]; then
    HEAD_SHA=$(git -C "${PLUGIN_DIR}" rev-parse HEAD 2>/dev/null || echo "")
    if [ "${HEAD_SHA}" = "${TESTED_COMMIT}" ]; then
      pass "Commit matches lock file (${TESTED_COMMIT:0:12})"
    else
      warn "Commit drift: installed ${HEAD_SHA:0:12}, lock records ${TESTED_COMMIT:0:12}"
      warn "Update external/soofi-team-kit.lock after testing new commit"
    fi
  else
    warn "testedCommit not set in lock file — run pnpm setup-soofi-plugin and update it"
  fi
else
  warn "Lock file not found: ${LOCK_FILE}"
fi

echo ""
if [ "${FAILED}" -eq 0 ]; then
  echo "✅  soofi team-kit plugin verified."
else
  echo "❌  Verification failed — see errors above."
  exit 1
fi
echo ""
