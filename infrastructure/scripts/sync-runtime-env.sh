#!/usr/bin/env bash
# Upload packages/runtime/.env to AWS Secrets Manager (artificer runtime-env secret).
#
# Usage:
#   ./infrastructure/scripts/sync-runtime-env.sh
#   ./infrastructure/scripts/sync-runtime-env.sh path/to/.env artificer/personal/runtime-env
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${1:-$ROOT/packages/runtime/.env}"
SECRET_ID="${2:-artificer/${ARTIFICER_ENV:-personal}/runtime-env}"
REGION="${AWS_REGION:-${CDK_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
REGION="${REGION:-us-east-1}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

echo "==> Syncing $ENV_FILE → Secrets Manager ($SECRET_ID) in $REGION"

SECRET_JSON="$(ENV_FILE="$ENV_FILE" python3 << 'PY'
import json, os, re
from pathlib import Path

env_file = Path(os.environ["ENV_FILE"])
overrides = {
    # Cloud host paths (local .env often uses ./data)
    "ARTIFICER_DATA_DIR": "/data",
    "PORT": "4100",
}

data: dict[str, str] = {}
for raw in env_file.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[7:].strip()
    m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
    if not m:
        continue
    key, val = m.group(1), m.group(2).strip()
    if (val.startswith('"') and val.endswith('"')) or (
        val.startswith("'") and val.endswith("'")
    ):
        val = val[1:-1]
    if val == "":
        continue
    data[key] = val

data.update(overrides)

if not (data.get("LLM_API_KEY") or data.get("ZEN_API_KEY") or data.get("ANTHROPIC_API_KEY")):
    raise SystemExit(
        "No LLM API key found in .env — set LLM_API_KEY (OpenCode Zen) "
        "or ANTHROPIC_API_KEY"
    )

print(json.dumps(data))
PY
)"

KEY_HINT="$(python3 -c "import json,sys; d=json.load(sys.stdin); print('LLM_API_KEY' if d.get('LLM_API_KEY') else 'ZEN_API_KEY' if d.get('ZEN_API_KEY') else 'ANTHROPIC_API_KEY')" <<< "$SECRET_JSON")"
echo "    Keys uploaded: $(python3 -c "import json,sys; print(', '.join(sorted(json.load(sys.stdin).keys())))" <<< "$SECRET_JSON")"
echo "    LLM key field: $KEY_HINT"

aws secretsmanager put-secret-value \
  --region "$REGION" \
  --secret-id "$SECRET_ID" \
  --secret-string "$SECRET_JSON"

echo "==> Done. Restart the cloud runtime to pick up changes:"
echo "    cd infrastructure && pnpm deploy:personal -- --skip-cdk"
