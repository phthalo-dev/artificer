# Artificer Personal Runtime (AWS)

Deploy the **runtime** + **UI console** to AWS. Send messages from your phone or laptop; the agent hibernates when idle.

**Expected idle cost:** ~$3–8/month (EBS + Elastic IP while stopped + SQS).

## What gets deployed

| Resource | Purpose |
|----------|---------|
| EC2 t3.small + Elastic IP | Runs runtime Docker + bridge sidecar |
| EBS 30GB | Persistent `/data` (workstreams, messages) |
| ECR | Runtime and bridge container images |
| SQS | Work queue while host is hibernating |
| API Gateway | `POST /work` wakes agent + enqueues messages |
| CloudFront + S3 | **Runtime UI** — dashboard, workstreams, composer |
| Secrets Manager | API auth token, runtime env (`ANTHROPIC_API_KEY`) |

```
Browser → CloudFront ─┬─► S3 (UI SPA)
                      └─► EC2:4100 (API reads: /state, /workstreams, …)

Message send → API Gateway POST /work → SQS + start EC2 → bridge → runtime
```

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity`)
- Docker running locally
- Node 20+, pnpm
- CDK bootstrapped once: `cd infrastructure && pnpm cdk:bootstrap`

## One-command deploy

From the repo root:

```bash
cd infrastructure
pnpm deploy:personal
```

This will:

1. Deploy/update the CDK stack
2. Build & push runtime + bridge images to ECR
3. Restart containers on EC2 via SSM
4. Build the UI with your CloudFront + wake API URLs
5. Sync the UI to S3 and invalidate CloudFront

## After first deploy

### 1. Set runtime secrets from your local `.env`

The cloud runtime reads [`packages/runtime/.env`](../packages/runtime/.env) keys from Secrets Manager. For **OpenCode Zen**, use `LLM_API_KEY` (not `ANTHROPIC_API_KEY` unless you point `LLM_BASE_URL` at Anthropic directly):

```env
LLM_API_KEY=sk-...
LLM_BASE_URL=https://opencode.ai/zen/v1
MODEL_PRESET=async-economy
AGENT_NAME=cloud-agent
```

Sync the whole file (cloud overrides `ARTIFICER_DATA_DIR=/data` and `PORT=4100` automatically):

```bash
pnpm infra:sync-env
# or: cd infrastructure && pnpm sync:runtime-env
```

Or set manually:

```bash
aws secretsmanager put-secret-value \
  --region us-west-2 \
  --secret-id artificer/personal/runtime-env \
  --secret-string '{"LLM_API_KEY":"sk-...","LLM_BASE_URL":"https://opencode.ai/zen/v1","AGENT_NAME":"cloud-agent"}'
```

The runtime accepts API keys in this order: `LLM_API_KEY` → `ZEN_API_KEY` → `ANTHROPIC_API_KEY`.

### 2. Restart containers to pick up secrets

```bash
cd infrastructure
pnpm deploy:personal -- --skip-cdk
```

### 3. Open the console

The deploy script prints a **ConsoleUrl** like `https://d1234abcd.cloudfront.net`.

- **Send messages** from the dashboard composer (uses wake API — works even when hibernating)
- **View workstreams** once the agent is awake and processing
- Dashboard shows **"hibernating or starting"** when the EC2 host is down

## Manual steps (alternative)

```bash
# Infra only
cd infrastructure && pnpm cdk:deploy -- -c environment=personal

# Get outputs
aws cloudformation describe-stacks --stack-name ArtificerRuntimeStack-personal \
  --query 'Stacks[0].Outputs'

# Images + UI (see scripts/deploy-personal.sh)
pnpm deploy:personal -- --skip-cdk
```

## Send work without the UI

```bash
WAKE_URL=$(aws cloudformation describe-stacks --stack-name ArtificerRuntimeStack-personal \
  --query "Stacks[0].Outputs[?OutputKey=='WakeApiUrl'].OutputValue" --output text)
TOKEN=$(aws secretsmanager get-secret-value --secret-id artificer/personal/api-auth-token \
  --query SecretString --output text)

curl -X POST "${WAKE_URL}/work" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"content":"Review the README and suggest improvements"}'
```

## Local development (no AWS)

```bash
pnpm --filter @artificer-ai/runtime dev
pnpm --filter @artificer-ai/ui dev   # http://localhost:5173 → localhost:4100
```

Leave `VITE_WAKE_API_URL` unset in `.env` — messages go directly to the runtime.

## Teardown

```bash
cd infrastructure && pnpm cdk:destroy -- -c environment=personal
```

Set a **$25 AWS Budget** alert as cheap insurance.

## Legacy stacks

Old always-on stacks (NAT, Aurora, Fargate, EC2-per-agent) live in [`lib/legacy/`](lib/legacy/) and are **not deployed**.
