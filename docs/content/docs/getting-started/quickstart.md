---
title: Quickstart
description: Get an agent running in under 5 minutes.
---

# Quickstart

Get an agent running in under 5 minutes.

## Prerequisites

- Node.js 21+
- An LLM API key — [OpenCode Zen](https://opencode.ai/zen/v1) is the default provider; Anthropic direct also works. Set it as `LLM_API_KEY` in your environment.

## Steps

### 1. Install the CLI

```bash
npm install -g @artificer-ai/cli
```

### 2. Scaffold a new agent project

```bash
artificer init my-agent
cd my-agent
npm install
```

This creates:

```
my-agent/
├── artificer.config.json
├── agent/
│   ├── instructions.md
│   ├── tools/
│   ├── channels/
│   └── skills/
├── identity/
│   └── memories/
├── package.json
├── .env
└── .env.example
```

### 3. Add your LLM API key

```bash
# Edit .env and set:
LLM_API_KEY=your_key_here
```

### 4. Start the agent

```bash
artificer dev
```

You should see:

```
[artificer] my-agent ready

  API   http://localhost:4100/api
  UI    http://localhost:4100
  SSE   http://localhost:4100/events

  identity  /Users/you/my-agent
  exec      /Users/you/.artificer/my-agent
```

### 5. Send it a message

Open `http://localhost:4100` in your browser and type a message like "What can you help with?"

Or via curl:

```bash
curl -X POST http://localhost:4100/api/messages \
  -H 'content-type: application/json' \
  -d '{"content": "What can you help with?"}'
```

### 6. Watch a workstream run

After sending a task (not just a question), the agent will create a workstream. View it in the UI at `http://localhost:4100` or check state via:

```bash
curl http://localhost:4100/api/state
```

## Next steps

- [How it works](/docs/introduction/how-it-works) — understand what's happening under the hood
- [Agent identity setup](/docs/guides/agent-identity-setup) — give the agent its own GitHub identity
- [Slack & Discord connections](/docs/guides/slack-discord-connections) — connect Slack or Discord
- [Core concepts](/docs/getting-started/core-concepts) — key terms explained
