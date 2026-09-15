---
title: Using Qwen Code as the Worker Executor
description: This guide explains how to configure Artificer to use [Qwen Code](https://github.com/QwenLM/qwen-code) as its worker executor instead of the built-in LLM loop.
---

# Using Qwen Code as the Worker Executor

This guide explains how to configure Artificer to use [Qwen Code](https://github.com/QwenLM/qwen-code) as its worker executor instead of the built-in LLM loop.

When Qwen Code is the executor, Artificer's planner and reviewer roles still run as normal LLM calls. Only the **worker** role is handed off — Artificer writes a task prompt and Qwen Code runs it autonomously in the workspace.

## Prerequisites

- Node.js 20 or later
- Qwen Code installed globally
- An Artificer identity directory with a working `artificer.config.json`

## 1. Install Qwen Code

```bash
npm install -g @qwen-code/qwen-code@latest
```

Or via Homebrew:

```bash
brew install qwen-code
```

Verify the install:

```bash
qwen --version
```

## 2. Authenticate Qwen Code

Run Qwen Code once interactively to complete authentication:

```bash
qwen
```

Inside the session, run `/auth` and follow the prompts. Qwen Code stores credentials globally, so you only need to do this once.

## 3. Configure the Executor

In your `artificer.config.json`, add an `executor` block:

```json
{
  "name": "YourAgentName",
  "executor": {
    "type": "cli",
    "command": "qwen",
    "args": ["--prompt", "{prompt}", "--yolo"],
    "promptMode": "arg",
    "mcpConfigPath": ".qwen/settings.json"
  }
}
```

### What each field does

| Field | Value | Purpose |
|---|---|---|
| `command` | `"qwen"` | The Qwen Code binary |
| `args` | `["--prompt", "{prompt}", "--yolo"]` | Headless invocation; `{prompt}` is replaced by the worker task at runtime |
| `promptMode` | `"arg"` | Task is passed as a CLI argument (not via stdin) |
| `mcpConfigPath` | `".qwen/settings.json"` | Where Artificer writes its MCP status config so Qwen Code can call `report_status` |

### The `--yolo` flag

`--yolo` (equivalent to `--approval-mode=yolo`) auto-approves all tool calls — necessary for unattended runs. Without it, Qwen Code pauses and waits for human confirmation on every file edit or shell command.

To suppress the YOLO warning banner in Artificer's logs, set this environment variable:

```bash
QWEN_CODE_SUPPRESS_YOLO_WARNING=1
```

### Optional: set the model

To pin a specific model, add a `model` field:

```json
{
  "executor": {
    "type": "cli",
    "command": "qwen",
    "args": ["--prompt", "{prompt}", "--yolo", "--model", "{model}"],
    "promptMode": "arg",
    "mcpConfigPath": ".qwen/settings.json",
    "model": "qwen3-coder-plus"
  }
}
```

### Optional: set a timeout

Worker runs default to 10 minutes. To change it:

```json
{
  "executor": {
    "type": "cli",
    "command": "qwen",
    "args": ["--prompt", "{prompt}", "--yolo"],
    "promptMode": "arg",
    "mcpConfigPath": ".qwen/settings.json",
    "timeout": 900000
  }
}
```

## 4. How it works

When Artificer runs a worker task, it:

1. Writes `{ mcpServers: { "artificer-status": { ... } } }` to `{workspaceDir}/.qwen/settings.json`. Because each workstream runs in a fresh cloned workspace, there is no pre-existing Qwen Code project config to overwrite.
2. Spawns `qwen --prompt "<task>" --yolo` in the workspace directory.
3. Qwen Code reads the MCP config at startup and connects to the Artificer status server.
4. When Qwen Code calls `report_status` or `submit_review` via MCP, Artificer captures the result and advances the workstream state machine.
5. On process exit, Artificer reads the result and continues orchestration as normal.

## 5. Verify it's working

Start Artificer and send a message that triggers a workstream:

```
Build a simple hello world Node.js script in https://github.com/your/repo
```

Check the run log in the Artificer UI. Worker runs should show `executor: cli:qwen` and the output should come from Qwen Code's response. If `report_status` was called, you'll see a structured status and summary rather than raw stdout.

## Known limitations

- **No `--mcp-config` flag yet.** Qwen Code does not currently accept a flag to specify the MCP config path at runtime — it reads from the project-level `.qwen/settings.json` only. If that changes in a future Qwen Code release, `mcpConfigPath` can be removed and `{mcpConfig}` used in `args` instead (same as Claude Code).
- **`.qwen/settings.json` is overwritten on every run.** If you manually add other Qwen Code project settings to this file inside the workspace, Artificer will replace them on the next worker run. Keep non-MCP settings in the global `~/.qwen/settings.json` instead.

## Related docs

- [Custom CLI Executors](/docs/guides/custom-cli-executor) — full reference for the `cli` executor config, placeholders, and MCP tool contract
- [Setting Up an Agent Identity Repo](/docs/guides/agent-identity-setup) — configure your agent project before adding an executor
