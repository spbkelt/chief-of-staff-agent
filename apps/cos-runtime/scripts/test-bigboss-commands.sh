#!/usr/bin/env bash
# Smoke-test all @bigboss commands from agents/bigboss.md (non-interactive).
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
LOG="/tmp/bigboss-cmd-test-$$.log"
: >"$LOG"

export COS_OPENSEARCH_USE_LOCAL_EMBED=true
if [[ -f "$HOME/.cos/aws-bootstrap-dev.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$HOME/.cos/aws-bootstrap-dev.env"
  set +a
fi

run_cmd() {
  local name="$1"
  shift
  echo ""
  echo "════════════════════════════════════════"
  echo "TEST: $name"
  echo "CMD:  $*"
  echo "════════════════════════════════════════"
  if "$@" >>"$LOG" 2>&1; then
    echo "RESULT: ✅ exit 0"
    return 0
  else
    local ec=$?
    echo "RESULT: ❌ exit $ec"
    tail -20 "$LOG" | sed 's/^/  /'
    return $ec
  fi
}

PASS=0
FAIL=0
SKIP=0

record() {
  if [[ "$1" == "pass" ]]; then PASS=$((PASS + 1)); elif [[ "$1" == "skip" ]]; then SKIP=$((SKIP + 1)); else FAIL=$((FAIL + 1)); fi
}

cd "$REPO"

run_cmd "validate" pnpm validate && record pass || record fail
run_cmd "inspect (graph stats)" pnpm inspect && record pass || record fail
run_cmd "account list" pnpm account && record pass || record fail
run_cmd "brief today" pnpm brief -- --date today && record pass || record fail
run_cmd "brief tomorrow" pnpm brief -- --date tomorrow && record pass || record fail
run_cmd "brief week" pnpm brief -- --date week && record pass || record fail
run_cmd "query (json)" pnpm query -- "urgent email today" && record pass || record fail
run_cmd "query (text)" pnpm query -- "calendar this week" --format text && record pass || record fail
run_cmd "paths (json)" pnpm paths -- "overdue Asana tasks" && record pass || record fail
run_cmd "paths (text)" pnpm paths -- "meeting prep" --format text && record pass || record fail
run_cmd "ingest (calendar only)" pnpm ingest -- --connector gcal && record pass || record fail
run_cmd "ingest last 7d" pnpm ingest -- --period 7d && record pass || record fail

# Resolve IDs for lifecycle commands
IDS=$(cd apps/cos-runtime && npx tsx -e "
import 'dotenv/config';
import { applyCosRuntimeEnv } from './src/config/runtime-env.js';
import { initSchema } from './src/graph/graph.db.js';
import { identityId } from './src/graph/canonical-id.js';
import { getEnv } from './src/config/env.js';
import { backendGetNodesByType } from './src/graph/backend.js';

applyCosRuntimeEnv();
await initSchema();
const env = getEnv();
const owner = identityId(env.COS_OWNER_EMAIL ?? '');
const notifs = await backendGetNodesByType(owner, 'Notification');
const tasks = await backendGetNodesByType(owner, 'AsanaTask');
const threads = await backendGetNodesByType(owner, 'EmailThread');
console.log([notifs[0]?.canonicalId ?? '', tasks[0]?.canonicalId ?? '', threads[0]?.canonicalId ?? ''].join('|'));
" 2>/dev/null) || IDS="||"

NOTIF_ID="${IDS%%|*}"
REST="${IDS#*|}"
TASK_ID="${REST%%|*}"
THREAD_ID="${REST##*|}"

run_cmd "notify list" pnpm notify && record pass || record fail

if [[ -n "$NOTIF_ID" ]]; then
  run_cmd "notify dismiss" pnpm dismiss -- "$NOTIF_ID" && record pass || record fail
  # Snooze a different notification if dismiss changed status
  NOTIF2=$(echo "$IDS" | cut -d'|' -f1)
  run_cmd "notify snooze 2h" pnpm snooze -- "$NOTIF_ID" --hours 2 && record pass || record fail
else
  echo "SKIP: dismiss/snooze (no notification id)"
  record skip
  record skip
fi

TARGET="${THREAD_ID:-$TASK_ID}"
if [[ -n "$TARGET" ]]; then
  run_cmd "suggest" pnpm suggest -- "$TARGET" && record pass || record fail
  SUG_ID=$(cd apps/cos-runtime && npx tsx -e "
import 'dotenv/config';
import { applyCosRuntimeEnv } from './src/config/runtime-env.js';
import { initSchema } from './src/graph/graph.db.js';
import { identityId } from './src/graph/canonical-id.js';
import { getEnv } from './src/config/env.js';
import { backendGetNodesByType } from './src/graph/backend.js';
applyCosRuntimeEnv();
await initSchema();
const owner = identityId(getEnv().COS_OWNER_EMAIL ?? '');
const s = await backendGetNodesByType(owner, 'SuggestedResponse');
const pending = s.find((n) => (n as { status?: string }).status === 'pending');
console.log(pending?.canonicalId ?? s[0]?.canonicalId ?? '');
" 2>/dev/null)
  if [[ -n "$SUG_ID" ]]; then
    run_cmd "reject suggestion" pnpm reject -- "$SUG_ID" --reject && record pass || record fail
  else
    echo "SKIP: reject (no suggestion id)"
    record skip
  fi
else
  echo "SKIP: suggest/reject (no target node)"
  record skip
  record skip
fi

run_cmd "history" pnpm history && record pass || record fail
run_cmd "history --limit 5" pnpm history -- --limit 5 && record pass || record fail
run_cmd "demo --skip-ingest" pnpm demo -- --skip-ingest && record pass || record fail

echo ""
echo "setup          — ⏭  skipped (interactive wizard)"
echo "disconnect     — ⏭  skipped (destructive)"
record skip
record skip

echo ""
echo "════════════════════════════════════════"
echo "SUMMARY: ✅ $PASS passed | ❌ $FAIL failed | ⏭  $SKIP skipped"
echo "Full log: $LOG"
echo "════════════════════════════════════════"

[[ "$FAIL" -eq 0 ]]
