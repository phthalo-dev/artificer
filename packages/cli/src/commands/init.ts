import fs from 'node:fs';
import path from 'node:path';

/** Keep in sync with the go-economy preset in @artificer-ai/runtime. */
const DEFAULT_PRESET_ID = 'go-economy';
const DEFAULT_MODELS = {
  low: 'deepseek-v4-flash',
  medium: 'kimi-k2.6',
  high: 'deepseek-v4-pro',
} as const;
const DEFAULT_ROLE_TIERS = {
  communicator: 'low',
  orchestrator: 'medium',
  planner: 'medium',
  reviewer: 'medium',
  worker: 'medium',
  librarian: 'low',
} as const;

/** Zen failover preset/models — keep in sync with async-economy in @artificer-ai/runtime. */
const ZEN_FALLBACK_PRESET_ID = 'async-economy';
const ZEN_FALLBACK_MODELS = {
  low: 'gpt-5-nano',
  medium: 'gpt-5.4-mini',
  high: 'gpt-5.4',
} as const;
const ZEN_FALLBACK_ROLE_TIERS = {
  communicator: 'low',
  orchestrator: 'low',
  planner: 'medium',
  reviewer: 'low',
  worker: 'medium',
  librarian: 'low',
} as const;

/** Default daily spend cap on the Zen failover route (overridable via QUOTA_DAILY_BUDGET_USD). */
const DEFAULT_DAILY_BUDGET_USD = 10;

/** Keep in sync with GO_WINDOWS in @artificer-ai/runtime quota-config-helpers. */
const GO_QUOTA_WINDOWS = [
  {
    id: 'rolling5h',
    unit: 'dollars',
    period: 'rolling5h',
    scope: 'global',
    limit: 12,
    warnAtPercent: 70,
    blockAtPercent: 90,
  },
  {
    id: 'weekly',
    unit: 'dollars',
    period: 'weekly',
    scope: 'global',
    limit: 30,
    warnAtPercent: 70,
    blockAtPercent: 90,
  },
  {
    id: 'monthly',
    unit: 'dollars',
    period: 'monthly',
    scope: 'global',
    limit: 60,
    warnAtPercent: 80,
    blockAtPercent: 95,
  },
] as const;

const DEFAULT_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
const DEFAULT_ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

export function makeConfigJson(name: string): string {
  return (
    JSON.stringify(
      {
        $schema:
          './node_modules/@artificer-ai/runtime/artificer.config.schema.json',
        name,
        description: 'An Artificer agent',
        preset: DEFAULT_PRESET_ID,
        identity: {
          autoCommit: true,
          autoPush: false,
        },
        quota: {
          reservePercent: 10,
          routes: [
            {
              id: 'primary',
              accountId: 'opencode-go',
              mode: 'windowed',
              execution: 'llm',
              llm: { baseURL: DEFAULT_GO_BASE_URL },
              presetId: DEFAULT_PRESET_ID,
              models: { ...DEFAULT_MODELS },
              roleTiers: { ...DEFAULT_ROLE_TIERS },
              windows: [...GO_QUOTA_WINDOWS],
            },
            {
              id: 'zen-failover',
              accountId: 'opencode-zen',
              mode: 'metered',
              execution: 'llm',
              llm: { baseURL: DEFAULT_ZEN_BASE_URL },
              presetId: ZEN_FALLBACK_PRESET_ID,
              models: { ...ZEN_FALLBACK_MODELS },
              roleTiers: { ...ZEN_FALLBACK_ROLE_TIERS },
              roles: ['planner', 'worker', 'reviewer'],
              windows: [
                {
                  id: 'daily-budget',
                  unit: 'dollars',
                  period: 'daily',
                  scope: 'global',
                  limit: DEFAULT_DAILY_BUDGET_USD,
                  warnAtPercent: 70,
                  blockAtPercent: 90,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ) + '\n'
  );
}

const GITIGNORE_TEMPLATE = `.env
node_modules/
# Uncomment if you override ARTIFICER_EXEC_DIR to a local path:
# .artificer/
`;

const ENV_EXAMPLE = `# LLM gateway (required — OpenCode Go subscription key for the default primary route)
LLM_API_KEY=
# LLM_BASE_URL=https://opencode.ai/zen/go/v1   # default primary; Zen failover is in artificer.config.json

# Agent identity
# AGENT_NAME=                                # overrides the name in artificer.config.ts

# Model selection (preset covers all tiers by default; override individual tiers here)
# MODEL_PRESET=go-economy                    # default; see presets in @artificer-ai/runtime
# LLM_MODEL=                                 # medium-complexity tier (planner, reviewer)
# LLM_MODEL_LOW=                             # low-complexity tier (communicator)
# LLM_MODEL_HIGH=                            # high-complexity tier (worker)

# Agent GitHub identity (optional — enables git push, gh pr create, and PR watching)
# GITHUB_TOKEN=
# GITHUB_WATCH_INTERVAL_MS=                  # poll interval for the agent's own PRs (ms)

# Docker / cloud deployment — clone identity repo on startup
# IDENTITY_REPO=org/my-agent-identity        # e.g. myorg/atlas-identity (GitHub repo)
# IDENTITY_DIR=/data/identity                # where to clone (default: /data/identity)
# GITHUB_USER_NAME=                          # override commit author name  (default: from GITHUB_TOKEN account)
# GITHUB_USER_EMAIL=                         # override commit author email (default: from GITHUB_TOKEN account)

# API authentication (required in production)
# ARTIFICER_API_KEY=

# Paths (optional — defaults shown)
# ARTIFICER_EXEC_DIR=~/.artificer/<name>     # where runs, workstreams, and workspace live
# ARTIFICER_IDENTITY_DIR=.                   # root of the identity repo (default: cwd)

# Runtime tuning (optional)
# PORT=4100
# RUNTIME_CONCURRENCY=2                      # max parallel LLM calls
# RUNTIME_MAX_RUNS_PER_WORKSTREAM=60
# RUNTIME_MAX_ITERATIONS=24                  # tool-use iterations per call
# RUNTIME_RESUME_ON_STARTUP=true             # resume interrupted workstreams on restart

# Quota & provider routes (defaults in artificer.config.json: Go primary → Zen failover)
# QUOTA_DAILY_BUDGET_USD=10                  # Zen failover daily-budget window limit
# QUOTA_RESERVE_PERCENT=10                   # % held for communicator replies near cap
# QUOTA_ON_EXHAUSTED=wait                    # wait | failover (meaningful with 2+ routes)

# Connection credentials
# SLACK_SIGNING_SECRET=
`;

const INSTRUCTIONS_TEMPLATE = `## Identity

This file is loaded as system context for every role in the runtime. Edit it to establish standing conventions, preferences, and context that should always be in scope.

---

## Project layout

This directory is the agent's identity root. Everything here defines who the agent is and how it operates.

\`\`\`
agent/
  instructions.md     ← this file; loaded into every role's system prompt
  tools/              ← custom tools (*.ts, default export from defineTool)
  skills/             ← reusable procedures (*.md titles become skill names)
  channels/           ← inbound message channels (*.ts, default export from defineChannel)
  roles/              ← role overrides (*.md with frontmatter)
identity/
  memories/           ← persistent memories (*.md with frontmatter, managed via API)
artificer.config.json ← agent name, model preset, quota configuration
\`\`\`

**What takes effect immediately:** memory changes (created or deleted via the API or by editing files directly).

**What requires a restart:** changes to instructions, skills, tools, channels, or roles.

---

## Roles

The runtime has six built-in roles. Each runs as a separate LLM call with its own system prompt and tool access:

- **communicator** — receives inbound messages, decides whether to respond directly or create a workstream
- **orchestrator** — breaks a goal into parallel workstreams and coordinates their execution
- **planner** — writes a detailed task plan for a single workstream
- **worker** — executes individual tasks (edits files, runs commands, calls tools)
- **reviewer** — reviews completed work against the original goal and plan
- **librarian** — manages memories; searches and writes to \`identity/memories/\`

Custom roles can be defined in \`agent/roles/\` to override or extend these.

---

## Memories

Memories are markdown files in \`identity/memories/\` with this structure:

\`\`\`markdown
---
id: "mem_abc123"
title: "Short label"
summary: "One-line gist used for search ranking"
tags: ["tag1", "tag2"]
kind: "note"
createdAt: "2024-01-01T00:00:00.000Z"
---

Memory content here.
\`\`\`

Valid \`kind\` values: \`note\`, \`document\`, \`preference\`.

Memories are created and searched by the librarian role, and can also be managed via the UI (Memories page) or \`POST /api/memories\`. Do not edit the \`id\` or \`createdAt\` fields of existing memories.

---

## Skills

A skill is a reusable procedure the agent can invoke by name. Add markdown files to \`agent/skills/\` — the filename (without \`.md\`) becomes the skill name, and the first heading becomes the description shown to the agent.

Example \`agent/skills/write-adr.md\`:

\`\`\`markdown
# Write an architecture decision record

When asked to document a decision, create a file in \`docs/decisions/\` following the standard ADR format:
title, status, context, decision, consequences.
\`\`\`

---

## Tools

Tools extend what the worker role can do. Add a \`.ts\` file to \`agent/tools/\` with a default export created by \`defineTool\`:

\`\`\`typescript
import { defineTool } from '@artificer-ai/runtime';

export default defineTool({
  name: 'my_tool',
  description: 'What this tool does',
  input: {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'Input value' },
    },
    required: ['value'],
  },
  execute: async ({ value }, ctx) => {
    // ctx.workspaceDir is the scoped workspace for this run
    return \`result: \${value}\`;
  },
});
\`\`\`

---

## Channels

Channels receive messages from external services (Slack, Discord, webhooks, etc.). Add a \`.ts\` file to \`agent/channels/\` with a default export created by \`defineChannel\`:

\`\`\`typescript
import { defineChannel } from '@artificer-ai/runtime';

export default defineChannel({
  name: 'my-channel',
  description: 'Receives messages from ...',
  receive: async (payload) => ({
    content: String(payload.text ?? ''),
  }),
  format: async (output) => ({
    text: output.content,
  }),
});
\`\`\`

The channel is mounted at \`POST /channels/my-channel\` on the runtime server.

---

## Role overrides

To customize how a built-in role behaves, add a \`.md\` file to \`agent/roles/\` with frontmatter:

\`\`\`markdown
---
name: "Senior Worker"
blurb: "Worker with stricter code quality rules"
baseRole: worker
---

Always write tests before implementation. Prefer small, focused functions.
Never leave TODO comments in committed code.
\`\`\`

Valid \`baseRole\` values: \`communicator\`, \`orchestrator\`, \`planner\`, \`worker\`, \`reviewer\`, \`librarian\`.

---

## About this agent

<!-- Add standing context here: team name, codebase conventions, preferred tools, etc. -->
`;

const DOCKERFILE_TEMPLATE = `FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
ENV ARTIFICER_EXEC_DIR=/data
ENV PORT=4100

# The agent shells out to git and gh for repository operations
RUN apt-get update \\
    && apt-get install -y --no-install-recommends \\
    git \\
    openssh-client \\
    ca-certificates \\
    curl \\
    gnupg \\
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \\
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \\
    && echo "deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \\
    && apt-get update \\
    && apt-get install -y --no-install-recommends gh \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY artificer.config.json ./
COPY agent ./agent
COPY identity ./identity

# Initialize a local git repo so identity.autoCommit works at runtime.
# Credentials for push are injected via GITHUB_TOKEN at runtime.
RUN git init \\
    && git config user.email "agent@artificer.local" \\
    && git config user.name "Artificer" \\
    && git add -A \\
    && git commit -m "init: agent identity"

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4100

CMD ["npm", "start"]
`;

const DOCKERIGNORE_TEMPLATE = `node_modules
.env
.git
*.log
`;

export function init(name: string, targetDir?: string): void {
  const dir = targetDir ?? path.resolve(process.cwd(), name);

  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new Error(`Directory ${dir} already exists and is not empty.`);
  }

  fs.mkdirSync(path.join(dir, 'agent', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agent', 'channels'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agent', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'identity', 'memories'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'artificer.config.json'),
    makeConfigJson(name),
  );
  fs.writeFileSync(path.join(dir, '.gitignore'), GITIGNORE_TEMPLATE);
  fs.writeFileSync(path.join(dir, '.env.example'), ENV_EXAMPLE);
  fs.writeFileSync(path.join(dir, '.env'), ENV_EXAMPLE);
  fs.writeFileSync(
    path.join(dir, 'agent', 'instructions.md'),
    INSTRUCTIONS_TEMPLATE,
  );
  fs.writeFileSync(path.join(dir, 'Dockerfile'), DOCKERFILE_TEMPLATE);
  fs.writeFileSync(path.join(dir, '.dockerignore'), DOCKERIGNORE_TEMPLATE);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        scripts: {
          start: 'artificer start',
          dev: 'artificer dev',
        },
        dependencies: {
          '@artificer-ai/runtime': 'latest',
          '@artificer-ai/cli': 'latest',
        },
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`Created ${name} at ${dir}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${name}`);
  console.log('  cp .env.example .env     # add your API keys');
  console.log('  npm install');
  console.log('  artificer dev');
  console.log('');
  console.log('To deploy to Fly.io, see https://github.com/artificer-ai/artificer/blob/main/docs/deploy-fly.md');
}
