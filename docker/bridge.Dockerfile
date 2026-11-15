# Bridge sidecar — polls SQS and forwards to the local runtime container.
FROM node:22-bookworm-slim

WORKDIR /app

RUN npm install -g pnpm@12.18.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/agent-gateway/package.json ./packages/agent-gateway/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --filter @artificer/orchestrator --frozen-lockfile

COPY packages/agent-gateway ./packages/agent-gateway
COPY packages/orchestrator ./packages/orchestrator
COPY packages/shared ./packages/shared
COPY tsconfig.json ./

WORKDIR /app/packages/orchestrator
CMD ["pnpm", "bridge"]
