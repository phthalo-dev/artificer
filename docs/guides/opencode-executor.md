# Using opencode as the Worker Executor

This guide explains how to configure Artificer to use [opencode](https://opencode.ai) as its worker executor instead of the built-in LLM loop.

When opencode is the executor, every `WORK_ROLES` role — `planner`, `worker`, and `reviewer` — is handed off to it, not just the worker. Artificer writes a role-specific prompt and opencode runs it autonomously in the workspace for each of the three; only roles outside `WORK_ROLES` (e.g. `communicator`, `librarian`) still run through Artificer's internal LLM loop.

## Prerequisites

- Node.js 21 or later
- The `opencode` CLI installed and authenticated
- An Artificer identity directory with a working `artificer.config.json`

## 1. Install opencode

```bash
npm install -g opencode-ai@latest
```

Verify the install:

```bash
opencode --version
```

## 2. Authenticate opencode

opencode needs at least one configured model provider before it can run headlessly. From any directory:

```bash
opencode auth
```

Follow the prompts to sign in (e.g. to an OpenCode Zen account) or configure a provider API key. Credentials are stored globally (`~/.local/share/opencode/auth.json`), so this is a one-time step.

Check which models are available to you:

```bash
opencode models
```

## 3. Configure the Executor

In your `artificer.config.json`, add an `executor` block:

```json
{
  "name": "YourAgentName",
  "executor": {
    "type": "opencode",
    "model": "opencode/gpt-5.4-mini"
  }
}
```

`model` is optional — omit it to let opencode use its own configured default. The model string format is `<provider>/<model>` (run `opencode models` to list valid values for your account).

## 4. How it works

When Artificer runs a worker task, it:

1. Writes `{ "mcp": { "artificer-status": { "type": "local", "command": [...], "enabled": true } } }` to `{workspaceDir}/opencode.json`. opencode discovers this automatically by walking up from its working directory — there's no `--mcp-config` flag to pass a path explicitly, unlike Claude Code.
2. Spawns `opencode run "<task>" --dangerously-skip-permissions --dir <workspaceDir> [--model <model>]`.
3. opencode reads the MCP config at startup and connects to the Artificer status server.
4. When opencode calls `report_status` or `submit_review` via MCP, Artificer captures the result and advances the workstream state machine.
5. On process exit, Artificer reads the result and continues orchestration as normal.

### The `--dangerously-skip-permissions` flag

opencode's non-interactive mode auto-*rejects* every tool-call permission prompt by default, including the `report_status`/`submit_review` MCP calls — unlike some other CLIs that default to allow. `--dangerously-skip-permissions` is required for unattended runs; without it, opencode will silently fail to call back into Artificer's status server.

### Timeout

Worker runs default to 10 minutes, matching the Claude Code executor. This isn't currently configurable per-executor the way the generic `cli` executor's `timeout` field is — file an issue if you need a longer window for large tasks.

## 5. Verify it's working

Start Artificer and send a message that triggers a workstream. Check the run log in the Artificer UI — worker runs should show `executor: opencode`, and the output should come from opencode's response. If `report_status` was called, you'll see a structured status and summary rather than raw stdout.

## Known limitations

- **No usage stats.** opencode's default (non-JSON) output doesn't surface token usage, so `usage` is always reported as `{ inputTokens: 0, outputTokens: 0 }` — cost tracking for opencode-executed work isn't currently possible.
- **`opencode.json` is overwritten on every run.** Each workstream runs in a fresh cloned workspace, so this is normally harmless, but don't hand-edit MCP config into a workspace opencode will reuse across runs.
- **Requires local opencode auth already configured** (`opencode auth`/`opencode providers`) — Artificer does not manage opencode's own provider credentials.

## Related docs

- [Custom CLI Executors](./custom-cli-executor.md) — the generic `cli` executor for CLIs that don't need a dedicated integration
- [Setting Up an Agent Identity Repo](./agent-identity-setup.md) — configure your agent project before adding an executor
