# Documentation Design

**Date:** 2026-07-01
**Status:** Approved

## Goal

Create authoritative, end-user-facing documentation for Artificer — structured as organized markdown files in `docs/` that can be wired into any documentation site later.

**Audience:** Developers using Artificer to run AI coding agents (not platform builders or contributors).

---

## Directory structure

```
docs/
├── introduction/
│   ├── what-is-artificer.md
│   └── how-it-works.md
├── getting-started/
│   ├── quickstart.md
│   └── core-concepts.md
├── guides/
│   ├── agent-identity-setup.md        ← exists, light refresh
│   ├── slack-discord-connections.md   ← exists, light refresh
│   ├── custom-cli-executor.md         ← exists, light refresh
│   ├── qwen-code-executor.md          ← exists, light refresh
│   ├── writing-custom-tools.md        ← new
│   ├── writing-custom-channels.md     ← new
│   ├── managing-memories.md           ← new
│   └── deploying-to-production.md     ← new (folds in deploy-fly.md)
└── reference/
    ├── cli.md
    ├── config.md
    ├── env-vars.md
    ├── api.md
    └── roles.md
```

The existing `docs/superpowers/`, `docs/research/`, and `docs/deploy-fly.md` are internal/archived — they stay in place but are not part of the public doc structure.

---

## Section 1: Introduction

### `introduction/what-is-artificer.md`

One-page answer to "what is this?":

- Artificer runs AI coding agents that have their own GitHub identity: their own account, commits, and PRs — not yours.
- The agent is a git repo (the "identity repo"): config, instructions, custom tools, channels, and agent-written memories all live there. Clone it anywhere to move the agent.
- You talk to the agent via a web UI, Slack, or Discord. It plans and executes work in the background and reports back.
- Self-hostable, open-source. Designed to look like a team member rather than a tool call.

Ends with links to the quickstart and the "how it works" explainer.

### `introduction/how-it-works.md`

The mental model for everything else:

- **The orchestration model**: communicator → orchestrator → planner/reviewer/worker. Each role is one LLM call. The orchestrator re-invokes itself after each child finishes. Includes the ASCII diagram from the runtime README, expanded with brief role descriptions.
- **What a workstream is**: lifecycle from inbound message → plan.md → tasks → done. The core unit of work.
- **The identity split**: the identity repo (config, instructions, memories — git-tracked, portable) vs execution state (`~/.artificer/<name>/` — workspaces, runs, messages — ephemeral). Why they are separate.
- **Per-call model tiers**: why different roles use different model sizes (communicator=low, orchestrator=medium, planner/worker=high) and how to override them.

---

## Section 2: Getting Started

### `getting-started/quickstart.md`

Fast path: zero to running agent, talking to it in the web UI.

1. Prerequisites: Node.js 21+, an LLM API key (`LLM_API_KEY`)
2. Install the CLI: `npm install -g @artificer-ai/cli`
3. `artificer init my-agent` — scaffold the identity repo
4. `cd my-agent && npm install`
5. Add `LLM_API_KEY` to `.env`
6. `artificer dev` — start the agent, shows the startup banner
7. Open `http://localhost:4100`, send a message, watch a workstream run

GitHub identity and channels are "next steps" links at the end — not prerequisites.

### `getting-started/core-concepts.md`

Expands on terms the quickstart uses without explanation. One section per concept, each concise:

- **Identity repo vs execution state** — what lives in the repo vs `~/.artificer/<name>/`
- **Workstreams** — the fundamental unit of work; plan → tasks → reviews → done
- **Roles** — communicator, orchestrator, planner, reviewer, worker (one sentence each)
- **Channels** — how messages get in (web UI, Slack, Discord)
- **Executors** — internal LLM loop vs CLI executor (Claude Code, Cursor, Qwen)
- **Memories** — agent-written, git-tracked markdown files in `identity/memories/`

Reference to read once after the quickstart; not a how-to.

---

## Section 3: Guides

Task-oriented how-tos. Imperative, step-by-step.

### Existing guides (light refresh)

Refresh scope: fix any references to old architecture, verify env var names match current code, ensure links between guides are consistent.

- `guides/agent-identity-setup.md` — GitHub token setup, `artificer init`, config, pushing to GitHub, production deployment
- `guides/slack-discord-connections.md` — Slack app + Discord app setup, channel files, webhook verification
- `guides/custom-cli-executor.md` — `type: "cli"` executor config, placeholders, MCP tool contract
- `guides/qwen-code-executor.md` — Qwen-specific executor config

### New guides

**`guides/writing-custom-tools.md`**
- Where to put tool files: `agent/tools/<name>.ts`
- `defineTool()` API: name, description, input schema, `roles`, `execute`
- How to add tool-specific secrets to `.env`
- Example: a Jira search tool (from the existing identity setup guide, expanded)
- Which roles a tool is available to and why you'd restrict it

**`guides/writing-custom-channels.md`**
- What a channel is: an inbound message adapter
- Where to put channel files: `agent/channels/<name>.ts`
- `defineChannel()` API: the `receive` and `reply` contract
- Webhook verification pattern (Slack and Discord do this — custom channels may need it too)
- Example: a simple HTTP webhook channel

**`guides/managing-memories.md`**
- Where memories live: `identity/memories/` (git-tracked)
- How the agent writes memories (the memory tool in the worker role)
- How to seed initial memories before the agent starts
- How git-tracking enables portability: clone the identity repo, memories come along
- How to inspect and manually edit memories

**`guides/deploying-to-production.md`**
- Set `ARTIFICER_API_KEY` (generate with `openssl rand -hex 32`)
- Run `artificer start` instead of `artificer dev`
- Using `IDENTITY_REPO` + `GITHUB_TOKEN` to pull the identity repo at container boot
- Fly.io deploy path (consolidates `docs/deploy-fly.md`)
- Docker / docker-compose path
- What to put in `.env` vs container secrets

---

## Section 4: Reference

Complete and factual. No narrative. Each file is the authoritative source for its topic.

### `reference/cli.md`

All three CLI commands with every flag and env var they read at startup:

| Command | Description |
|---|---|
| `artificer init <name>` | Scaffold a new agent identity repo |
| `artificer dev` | Start in development mode (no API key required) |
| `artificer start` | Start in production mode (API key enforced) |

Each command gets: synopsis, options table, environment variables it reads, example output.

### `reference/config.md`

Full `artificer.config.json` schema. Every field: type, default, description.

Top-level fields: `name`, `description`, `preset`, `identity` (with `autoCommit`, `autoPush`), `executor`.

The `executor` block fully documented (mirrors `custom-cli-executor.md` guide but in reference format).

### `reference/env-vars.md`

Single consolidated table of every environment variable across the runtime and CLI. Columns: variable name, required/optional, which component reads it, description. Currently scattered across the runtime README and individual guides — this becomes the single source of truth.

Groups:
- LLM / model config (`LLM_API_KEY`, `LLM_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_MODEL_LOW`, `ANTHROPIC_MODEL_HIGH`, `RUNTIME_TIER_*`)
- GitHub identity (`GITHUB_TOKEN`, `GITHUB_USER_NAME`, `GITHUB_USER_EMAIL`, `IDENTITY_REPO`, `IDENTITY_DIR`)
- Runtime behavior (`PORT`, `ARTIFICER_DATA_DIR`, `ARTIFICER_EXEC_DIR`, `RUNTIME_CONCURRENCY`, `RUNTIME_MAX_ITERATIONS`, `RUNTIME_MAX_RUNS_PER_WORKSTREAM`, `ARTIFICER_VERBOSE`)
- Security (`ARTIFICER_API_KEY`)
- Channels (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`)

### `reference/api.md`

The HTTP API. Every endpoint, request/response shape, and the SSE event format.

Endpoints:
- `POST /api/messages` — send a message to the agent
- `GET /api/messages` — full conversation history
- `GET /api/state` — high-level snapshot (workstreams, queue, active runs)
- `GET /api/workstreams` — list workstreams
- `GET /api/workstreams/:id` — workstream detail (tasks, reviews, plan, runs)
- `GET /api/events` — SSE stream of state changes
- `GET /api/health` — liveness check
- `GET /api/usage` — cost/token usage breakdown by model

Authentication: `Authorization: Bearer <ARTIFICER_API_KEY>` when key is set.

### `reference/roles.md`

Each role: what it does, default model tier, tool access, and how to override its tier.

| Role | Purpose | Default tier | Override env var |
|---|---|---|---|
| communicator | Receives messages, routes intent, sends replies | low | `RUNTIME_TIER_COMMUNICATOR` |
| orchestrator | Owns a workstream, dispatches and re-invokes child calls | medium | `RUNTIME_TIER_ORCHESTRATOR` |
| planner | Produces `plan.md` for a workstream | high | `RUNTIME_TIER_PLANNER` |
| reviewer | Reviews plan or work, records notes | medium | `RUNTIME_TIER_REVIEWER` |
| worker | Implements a single focused unit of work | high | `RUNTIME_TIER_WORKER` |

---

## Out of scope

- Contributor/developer docs (package internals, architecture decisions)
- `docs/superpowers/` internal planning files
- `docs/research/` competitive analysis
- Versioning or i18n (doc site concern, not a content concern)

---

## Success criteria

- A developer with no prior context can go from zero to running agent using only the quickstart.
- Every env var in the codebase appears in `reference/env-vars.md`.
- Every guide links to relevant reference pages and vice versa.
- The existing guides (`agent-identity-setup.md`, `slack-discord-connections.md`, etc.) are the same files in the same location — no broken links.
