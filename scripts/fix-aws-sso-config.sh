#!/usr/bin/env bash
#
# Fix ~/.aws/config when cos-default SSO login fails (InvalidRequestException).
#
# Cause: duplicate [sso-session cos-session] with wrong sso_region (must match
# IAM Identity Center home region, e.g. eu-west-1 — not the Bedrock/DynamoDB region).
#
# This script:
#   1. Backs up ~/.aws/config
#   2. Removes [sso-session cos-session] if present
#   3. Points [profile cos-default] at sso_session = aws-toptal-lab (your working session)
#
# Usage:
#   ./scripts/fix-aws-sso-config.sh
#   aws sso login --profile cos-default
#
set -euo pipefail

CFG="${HOME}/.aws/config"
if [[ ! -f "$CFG" ]]; then
  echo "No $CFG found." >&2
  exit 1
fi

BACKUP="${CFG}.bak.$(date +%Y%m%d%H%M%S)"
cp "$CFG" "$BACKUP"
echo "Backup: $BACKUP"

python3 <<'PY'
import re
from pathlib import Path

p = Path.home() / ".aws/config"
text = p.read_text()

# Drop broken duplicate sso-session cos-session block
text = re.sub(
    r"\n\[sso-session cos-session\]\n(?:[^\[]*\n)*",
    "\n",
    text,
    count=1,
)

# cos-default → reuse aws-toptal-lab (same portal, correct sso_region)
if re.search(r"^\[profile cos-default\]", text, re.M):
    text = re.sub(
        r"(^\[profile cos-default\]\nsso_session = )cos-session",
        r"\1aws-toptal-lab",
        text,
        count=1,
        flags=re.M,
    )
else:
    text += """
[profile cos-default]
sso_session = aws-toptal-lab
sso_account_id = 998765338360
sso_role_name = AdministratorAccess
region = us-east-1
output = json
"""

p.write_text(text)
print(f"Patched {p}")
print("  [profile cos-default] → sso_session = aws-toptal-lab")
print("  Removed [sso-session cos-session] if it existed")
PY

echo ""
echo "Next:"
echo "  aws sso login --profile cos-default"
echo "  aws sts get-caller-identity --profile cos-default"
echo ""
echo "Note: cos-session is an SSO session block name, not a profile — do not run"
echo "  aws sso login --profile cos-session"
