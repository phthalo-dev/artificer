#!/usr/bin/env bash
# Deploy personal Artificer runtime + UI to AWS.
#
# Usage:
#   ./infrastructure/scripts/deploy-personal.sh
#   ./infrastructure/scripts/deploy-personal.sh --skip-cdk   # images + UI only
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INFRA="$ROOT/infrastructure"
ENV="${ARTIFICER_ENV:-personal}"
# Match CDK: AWS_REGION / CDK_DEFAULT_REGION / aws configure / fallback
REGION="${AWS_REGION:-${CDK_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
REGION="${REGION:-us-east-1}"
export AWS_REGION="$REGION"
export CDK_DEFAULT_REGION="$REGION"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
RUNTIME_REPO="artificer-${ENV}-runtime"
BRIDGE_REPO="artificer-${ENV}-bridge"
STACK="ArtificerRuntimeStack-${ENV}"

SKIP_CDK=false
for arg in "$@"; do
  case "$arg" in
    --skip-cdk) SKIP_CDK=true ;;
  esac
done

echo "==> Deploying Artificer (${ENV}) to account ${ACCOUNT} / ${REGION}"

if [[ "$SKIP_CDK" == false ]]; then
  echo "==> CDK deploy (infra)"
  (cd "$INFRA" && pnpm cdk:deploy -- \
    -c "environment=${ENV}" \
    -c "region=${REGION}" \
    --require-approval never)
fi

echo "==> Reading stack outputs"
outputs() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${1}'].OutputValue" \
    --output text
}

WAKE_URL="$(outputs WakeApiUrl)"
CF_URL="$(outputs ConsoleUrl)"
BUCKET="$(outputs UiBucketName)"
DIST_ID="$(outputs CloudFrontDistributionId)"
INSTANCE_ID="$(outputs RuntimeInstanceId)"
AUTH_SECRET_ARN="$(outputs ApiAuthSecretArn)"
RUNTIME_ENV_SECRET_ARN="$(outputs RuntimeEnvSecretArn)"
RUNTIME_ECR="$(outputs RuntimeEcrUri)"
BRIDGE_ECR="$(outputs BridgeEcrUri)"
QUEUE_URL="$(outputs WorkQueueUrl)"

WAKE_TOKEN="$(aws secretsmanager get-secret-value \
  --secret-id "$AUTH_SECRET_ARN" \
  --region "$REGION" \
  --query SecretString --output text)"

echo "==> ECR login"
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "==> Build & push runtime image (linux/amd64 for EC2)"
docker build --platform linux/amd64 -t "${RUNTIME_ECR}:latest" -f "$ROOT/packages/runtime/Dockerfile" "$ROOT/packages/runtime"
docker push "${RUNTIME_ECR}:latest"

echo "==> Build & push bridge image (linux/amd64 for EC2)"
docker build --platform linux/amd64 -t "${BRIDGE_ECR}:latest" -f "$ROOT/docker/bridge.Dockerfile" "$ROOT"
docker push "${BRIDGE_ECR}:latest"

echo "==> Bootstrap / restart runtime host via SSM"
BOOTSTRAP_SCRIPT="$(mktemp)"
PARAMS_FILE="$(mktemp)"
trap 'rm -f "$BOOTSTRAP_SCRIPT" "$PARAMS_FILE"' EXIT
cat > "$BOOTSTRAP_SCRIPT" <<SETUP
export AWS_REGION=${REGION}
export ARTIFICER_ECR_RUNTIME=${RUNTIME_ECR}
export ARTIFICER_ECR_BRIDGE=${BRIDGE_ECR}
export SQS_QUEUE_URL=${QUEUE_URL}
export RUNTIME_ENV_SECRET_ARN=${RUNTIME_ENV_SECRET_ARN}
$(cat "$INFRA/user-data/runtime-setup.sh")
SETUP

# SSM RunShellScript expects a JSON array of command strings.
PARAMS_FILE="$(mktemp)"
trap 'rm -f "$BOOTSTRAP_SCRIPT" "$PARAMS_FILE"' EXIT
python3 -c "
import json, pathlib
script = pathlib.Path('${BOOTSTRAP_SCRIPT}').read_text()
payload = {
    'InstanceIds': ['${INSTANCE_ID}'],
    'DocumentName': 'AWS-RunShellScript',
    'TimeoutSeconds': 600,
    'Parameters': {'commands': [script]},
}
pathlib.Path('${PARAMS_FILE}').write_text(json.dumps(payload))
"

CMD_ID="$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --timeout-seconds 600 \
  --cli-input-json "file://${PARAMS_FILE}" \
  --query Command.CommandId --output text)"

echo "    SSM command: $CMD_ID (waiting…)"
if ! aws ssm wait command-executed --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" --region "$REGION"; then
  echo "    SSM bootstrap failed — fetching output:"
  aws ssm get-command-invocation \
    --command-id "$CMD_ID" \
    --instance-id "$INSTANCE_ID" \
    --region "$REGION" \
    --query '[Status,StandardOutputContent,StandardErrorContent]' \
    --output text
  exit 1
fi
echo "    Host bootstrap complete"

echo "==> Build runtime-ui"
(
  cd "$ROOT"
  VITE_RUNTIME_URL="${CF_URL}" \
  VITE_WAKE_API_URL="${WAKE_URL}" \
  VITE_WAKE_API_TOKEN="${WAKE_TOKEN}" \
  pnpm --filter @artificer/runtime-ui build
)

echo "==> Sync UI to S3"
aws s3 sync "$ROOT/apps/runtime-ui/dist/" "s3://${BUCKET}/" --delete --region "$REGION"

echo "==> Invalidate CloudFront"
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' --output text

echo ""
echo "Done!"
echo "  Console:  ${CF_URL}"
echo "  Wake API: ${WAKE_URL}/work"
echo ""
echo "If this is the first deploy, sync runtime secrets from your local .env:"
echo "  pnpm infra:sync-env"
echo "  cd infrastructure && pnpm deploy:personal -- --skip-cdk"
