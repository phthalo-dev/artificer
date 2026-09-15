---
title: Custom CLI Executors
description: By default, Artificer's worker role runs as an internal LLM tool loop.
---

# Custom CLI Executors

By default, Artificer's worker role runs as an internal LLM tool loop. You can swap it out for any local CLI agent that supports MCP — without writing any code — using the `type: "cli"` executor config.

## How it works

When a worker task is dispatched, Artificer:

1. Writes an MCP server config to the workspace so the CLI can call `report_status` and `submit_review` back to Artificer.
2. Spawns your CLI in the workspace directory with the task prompt injected via arguments or stdin.
3. Waits for the process to exit (or a timeout), then reads the MCP status file and advances the workstream.

The planner, reviewer, and communicator roles are unaffected — they continue to use Artificer's internal LLM loop. Only the worker is handed off.

## Minimum requirements for a compatible CLI

- Accepts a task prompt (via a flag or stdin)
- Runs non-interactively and exits when done
- Supports MCP via either:
  - A `--mcp-config <path>` flag that points to a JSON config file, **or**
  - A project-level config file at a known path relative to the workspace (e.g. `.qwen/settings.json`)

## Configuration

Add an `executor` block to your `artificer.config.json`:

```json
{
  "executor": {
    "type": "cli",
    "command": "<binary>",
    "args": ["<arg1>", "<arg2>", "..."],
    "promptMode": "stdin" | "arg",
    "model": "<optional-model-string>",
    "timeout": 600000,
    "mcpConfigPath": "<optional-relative-path>"
  }
}
```

### Fields

| Field | Required | Description |
|---|---|---|
| `type` | yes | Must be `"cli"` |
| `command` | yes | The binary to spawn (must be on `PATH`) |
| `args` | yes | Argument template array; may contain placeholders (see below) |
| `promptMode` | yes | How the task prompt is delivered: `"stdin"` or `"arg"` |
| `model` | no | Passed into the `{model}` placeholder; omit to let the CLI use its default |
| `timeout` | no | Max runtime in milliseconds before the process is killed. Default: 600000 (10 min) |
| `mcpConfigPath` | no | Workspace-relative path where Artificer writes its MCP config. Default: `.artificer-mcp.json` |

### Placeholders

Use these in your `args` array. They are substituted at runtime before the process is spawned.

| Placeholder | Value |
|---|---|
| `{prompt}` | The full worker task text (only meaningful with `promptMode: "arg"`) |
| `{mcpConfig}` | Absolute path to the written MCP config file |
| `{workspaceDir}` | Absolute path to the run workspace directory |
| `{model}` | The value of the `model` field; see optional-arg dropping below |

#### Optional-arg dropping

When a placeholder like `{model}` is the entire content of an arg (not mixed with other text) and its value is empty or unset, that arg is silently dropped. If the immediately preceding arg starts with `-`, it is dropped too. This lets you write `["--model", "{model}"]` and have it collapse cleanly when no model is configured, without passing an empty string to the CLI.

### `promptMode`

**`"stdin"`** — Artificer writes the task prompt to the process's stdin and closes it. Do not include `{prompt}` in `args`.

```json
"args": ["--print", "--mcp-config", "{mcpConfig}"],
"promptMode": "stdin"
```

**`"arg"`** — The task prompt is passed as a positional argument. Include `{prompt}` in `args` at the position the CLI expects it.

```json
"args": ["--prompt", "{prompt}", "--yolo"],
"promptMode": "arg"
```

### `mcpConfigPath`

Artificer writes a JSON file of this shape to the workspace before spawning the CLI:

```json
{
  "mcpServers": {
    "artificer-status": {
      "command": "/path/to/node",
      "args": ["/path/to/mcp-status-server.mjs", "/path/to/.artificer-status.json"]
    }
  }
}
```

By default this file is written to `{workspaceDir}/.artificer-mcp.json` and you pass its path to the CLI via the `{mcpConfig}` placeholder:

```json
"args": ["--mcp-config", "{mcpConfig}"]
```

If your CLI does not accept a config path flag and instead reads from a fixed location (such as `.qwen/settings.json`), set `mcpConfigPath` to that location and omit `{mcpConfig}` from `args`:

```json
"mcpConfigPath": ".qwen/settings.json"
```

Parent directories are created automatically. If the file already exists it is overwritten — because each workstream runs in a fresh cloned workspace, there is normally nothing to preserve.

## Examples

### Claude Code (stdin, `--mcp-config` flag)

```json
{
  "executor": {
    "type": "cli",
    "command": "claude",
    "args": [
      "--print",
      "--dangerously-skip-permissions",
      "--mcp-config", "{mcpConfig}",
      "--model", "{model}"
    ],
    "promptMode": "stdin",
    "model": "claude-sonnet-4-6"
  }
}
```

### Cursor Agent (arg, `--workspace` flag, fixed model position)

```json
{
  "executor": {
    "type": "cli",
    "command": "cursor",
    "args": [
      "agent", "--print", "--trust", "--yolo", "--approve-mcps",
      "--workspace", "{workspaceDir}",
      "--model", "{model}",
      "{prompt}"
    ],
    "promptMode": "arg"
  }
}
```

### Qwen Code (arg, project-level settings file)

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

### A hypothetical CLI (stdin, `--mcp-config` flag)

```json
{
  "executor": {
    "type": "cli",
    "command": "my-agent",
    "args": [
      "--headless",
      "--mcp-config", "{mcpConfig}",
      "--workspace", "{workspaceDir}",
      "--model", "{model}"
    ],
    "promptMode": "stdin",
    "timeout": 1200000
  }
}
```

## MCP tool contract

Artificer exposes two MCP tools to the CLI via the status server. The CLI should call one of them before it exits — otherwise Artificer treats the run as having no structured output and relies on raw stdout alone.

**`report_status`** — used by worker runs:

| Field | Type | Description |
|---|---|---|
| `status` | `"done"` \| `"done_with_concerns"` \| `"blocked"` \| `"needs_context"` | Outcome of the run |
| `summary` | string | What was done (or attempted) and what verification was run |
| `followUps` | string? | Optional notes for the reviewer |

**`submit_review`** — used when the CLI is acting as a reviewer:

| Field | Type | Description |
|---|---|---|
| `approved` | boolean | Whether the work is approved |
| `notes` | string | Review findings, grouped by severity |
| `stage` | `"plan"` \| `"work"` | What was reviewed |
| `severity` | `"critical"` \| `"important"` \| `"minor"` \| `"none"` | Highest severity found |

If the CLI exits with a non-zero code, the run is marked failed and the stderr output is used as the error message.

## Compatibility notes

| Pattern | Supported | Notes |
|---|---|---|
| `--mcp-config <path>` flag | Yes | Use `{mcpConfig}` in args |
| Project-level JSON config file | Yes | Set `mcpConfigPath` to the relative path |
| Global-only config (e.g. `~/.config/tool/config.yaml`) | No | Concurrent runs would contend on the same file |
| YAML MCP config format | No | Artificer writes JSON only |
| CLIs without MCP support | No | `report_status` / `submit_review` will not be called; raw stdout is used as output |

## Related docs

- [Using Qwen Code as the Worker Executor](/docs/guides/qwen-code-executor) — a concrete walkthrough using the `cli` executor with Qwen Code
- [Using opencode as the Worker Executor](/docs/guides/opencode-executor) — a dedicated (non-`cli`-type) executor, for CLIs whose MCP config doesn't fit this generic template
- [Setting Up an Agent Identity Repo](/docs/guides/agent-identity-setup) — configure your agent project before adding an executor
