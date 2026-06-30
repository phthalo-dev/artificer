# Multi-stage production build: compiles the UI and runtime TypeScript,
# then produces a minimal image with only the compiled output and production deps.

FROM node:22-bookworm-slim AS deps
RUN npm install -g pnpm@8.15.1
WORKDIR /workspace

# Copy workspace manifests first so this layer is cached until deps change
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runtime/package.json ./packages/runtime/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY infrastructure/package.json ./infrastructure/package.json
RUN pnpm install --frozen-lockfile

# --- Build UI ---
FROM deps AS builder
COPY packages/ui ./packages/ui
RUN pnpm --filter @artificer-ai/ui build

# --- Build runtime and bundle UI dist ---
COPY packages/runtime/tsconfig.json ./packages/runtime/tsconfig.json
COPY packages/runtime/src ./packages/runtime/src
RUN pnpm --filter @artificer-ai/runtime build
RUN mkdir -p packages/runtime/ui-dist && cp -r packages/ui/dist/* packages/runtime/ui-dist/

# --- Runtime image ---
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
ENV ARTIFICER_DATA_DIR=/data
ENV PORT=4100

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    ca-certificates \
    curl \
    gnupg \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /workspace/packages/runtime/package.json ./
COPY --from=builder /workspace/packages/runtime/dist ./dist
COPY --from=builder /workspace/packages/runtime/ui-dist ./ui-dist
RUN npm install --omit=dev

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4100

CMD ["node", "dist/index.js"]
