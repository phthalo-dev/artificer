# Config Reference

`artificer.config.json` is the agent's configuration file, located at the root of the identity repo. Your editor should offer JSON schema autocomplete if the `$schema` field resolves correctly.

---

## Full schema

### Top-level fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | No | directory name | Display name for the agent |
| `description` | string | No | — | Human-readable description (shown in logs and UI) |
| `preset` | string | No | `"async-economy"` | Model preset ID to apply on startup (see [Presets](#presets)) |
| `concurrency` | number | No | `2` | Max concurrent in-flight LLM calls across all workstreams |
| `maxIterationsPerCall` | number | No | `24` | Max tool-use iterations allowed within a single call before forcing a stop |
| `port` | number | No | `4100` | HTTP port for the runtime server |
| `execDir` | string | No | `~/.artificer/<name>` | Root directory where execution artifacts are persisted (runs, workstreams, workspace) |

### Codemode (`execute` tool)

Worker and orchestrator can call `execute` to run a small JavaScript program that sequences their other tools. Limits are env-only (not `artificer.config.json`):

| Env | Default | Description |
|---|---|---|
| `RUNTIME_CODEMODE_TIMEOUT_MS` | `120000` | Wall-clock cap for one `execute` program (QuickJS interrupt). Does not SIGKILL in-flight `run_shell`. |
| `RUNTIME_CODEMODE_MAX_TOOL_CALLS` | `32` | Max inner tool calls admitted during one `execute`. |
| `RUNTIME_CODEMODE_MAX_OUTPUT_BYTES` | `12000` | UTF-8 cap on the JSON result (`value` + `logs`). Oversize returns `truncated: true`. |

### Tool approval policy

Tools marked with `needsApproval` are deny-by-default: their handlers run only when a matching `allow` rule exists. A matching deny returns a structured `approval_denied` tool error; no matching rule returns `approval_required`. Approval does not pause a call to wait for a person—the policy must be updated and the tool call retried.

In v1, all rules are agent-wide and use `scope: "agent"`. Per-run and per-workstream scopes are not supported.

The runtime loads policy rules from:

- `<execDir>/tool-policy.json`, resolved by `Layout.toolPolicyFile()`
- Optional identity policy at `<identity-repo>/agent/tool-policy.json`

Exec-directory rules override identity rules with the same tool and pattern. A missing or corrupt file is treated as an empty rule set and produces a warning, so approval-gated actions fail closed.

The built-in `run_shell` tool gates dangerous commands. The built-in `fetch_url` schema is `GET`-only, so its requests remain ungated. A fetch-style tool named `fetch` or `fetch_url` with a non-`GET` method would require a matching allow rule. Hard shell-policy denies and URL/private-IP guards are separate and unchanged; an approval allow rule does not bypass them.

The runtime exposes no model-facing API or tool for changing policy. Exec-directory policy mutations are available only through `POST /api/policy/rules` and `DELETE /api/policy/rules/:id`; this is an API boundary, not a claim that an OS sandbox prevents other filesystem access. Autonomous agents should ship useful identity-level allow rules in `agent/tool-policy.json` for their normal workflow. See the bearer-authenticated [policy API](./api.md#tool-approval-policy).

### `models` block

Override individual model tiers. All fields are optional; unset tiers fall back to the active preset.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `models.low` | string | No | preset value | Model ID for low-complexity tasks (routing, comms) |
| `models.medium` | string | No | preset value | Model ID for medium-complexity tasks (coordination, standard work) |
| `models.high` | string | No | preset value | Model ID for high-complexity tasks (planning, hard coding steps) |

### `roleTiers` block

Override which model tier each internal role uses. Any role not specified inherits from the active preset. Valid tiers are `"low"`, `"medium"`, and `"high"`.

Roles: `communicator`, `orchestrator`, `planner`, `reviewer`, `worker`, `librarian`.

Example: `{ "worker": "high", "planner": "high" }`

### `github` block

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `github.watchInterval` | string | No | — | Polling interval for the agent's own PRs and notifications. Accepts duration strings: `"30s"`, `"5m"`, `"1h"`. Absent or unset disables background GitHub polling |

### `identity` block

Controls how the agent commits and pushes memories to the identity repo after each run.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `identity.autoCommit` | boolean | No | `false` | Auto-commit memories to the identity repo after each run |
| `identity.autoPush` | boolean | No | `false` | Auto-push the identity repo after each auto-commit |
| `identity.commitPrefix` | string | No | — | Prefix prepended to auto-commit messages |
| `identity.remote` | string | No | `"origin"` | Git remote name to push to |
| `identity.branch` | string | No | current branch | Branch to push to |
| `identity.pullInterval` | string | No | — | How often to pull identity from origin (including schedule files in `agent/schedules/`). Accepts duration strings: `"30s"`, `"5m"`, `"1h"`, `"1d"`. Absent or unset disables periodic identity pull. See [Schedules Reference](./schedules.md) |

### `executor` block

Selects the worker execution backend. Omitting this field uses the built-in LLM tool loop.

**String shortcuts:**

| Value | Description |
|---|---|
| `"llm"` | Built-in internal tool loop (default) |
| `"cursor-agent"` | Cursor agent executor (uses default model) |
| `"claude-code"` | Claude Code executor (uses default model) |

**Object form — `cursor-agent` and `claude-code`:**

| Field | Type | Required | Description |
|---|---|---|---|
| `executor.type` | `"cursor-agent"` \| `"claude-code"` | Yes | Executor type |
| `executor.model` | string | No | Model string passed to the executor |

**Object form — `cli`:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `executor.type` | `"cli"` | Yes | — | Must be `"cli"` to enable the CLI executor |
| `executor.command` | string | Yes | — | Binary to spawn |
| `executor.args` | string[] | Yes | — | Argument template; supports `{model}` and `{mcpConfig}` placeholders |
| `executor.promptMode` | `"stdin"` \| `"arg"` | Yes | — | How the task prompt is delivered to the process |
| `executor.model` | string | No | — | Model string substituted into the `{model}` placeholder |
| `executor.timeout` | number | No | `600000` | Max milliseconds before the process is killed |
| `executor.mcpConfigPath` | string | No | `".artificer-mcp.json"` | Relative path for the MCP config file; substituted into `{mcpConfig}` |

### `quota` block

Configures quota windows, spend budgets, and failover routing across multiple LLM accounts. This is an advanced field; see the quota documentation for full details.

---

## Presets

Pass a preset ID as the `preset` field to select a model assignment profile on startup. Environment variable `MODEL_PRESET` overrides the config file value.

**Standard presets (OpenCode Zen `/zen/v1`):**

| ID | Name | Description |
|---|---|---|
| `async-economy` | Async economy | Default cost-first profile. Cheap orchestration and review; gpt-5.4-mini does the work; gpt-5.4 for escalation. |
| `ultra-budget` | Ultra budget | Minimum spend. Codex-mini workers, nano routing, mini-tier escalation only. |
| `async-slow` | Async slow | Same role map as async economy but kimi-k2.6 as the workhorse — slower, still cheap on DeepSWE. |
| `quality-first` | Quality first | Latency/quality profile. Haiku comms, Sonnet coordination, Opus for planning and coding. |
| `bench-budget` | Bench budget | Previous bench experiment stack (nano / gemini-3-flash / gpt-5.4-mini) for A/B comparison. |
| `open-weights-economy` | Open weights economy | Zen-hosted open-weight stack: North Mini Code and Laguna S free tiers for bulk work, Kimi K3 for escalation. Requires `LLM_BASE_URL=https://opencode.ai/zen/v1`. |
| `baseten-open-weights` | Baseten open weights | Baseten Model APIs: Inkling Small workers, Inkling coordination, Kimi K3 escalation. Requires `LLM_BASE_URL=https://inference.baseten.co/v1` and `BASETEN_API_KEY`. |

**Go presets (OpenCode Zen `/zen/go/v1`):**

| ID | Name | Description |
|---|---|---|
| `go-economy` | Go economy | Recommended Go profile: flash routing, kimi-k2.6 workers, deepseek-v4-pro escalation. Best async value/correctness ratio on the Go subscription. |
| `go-flash` | Go flash | Cheapest Go stack for high-volume bench iteration. DeepSeek V4 Flash everywhere except escalation. |
| `go-mimo` | Go MiMo | Volume-first Go profile. MiMo-V2.5 for bulk async work; MiMo-V2.5-Pro for hard steps. |
| `go-quality` | Go quality | Strongest open models on Go while keeping async-economy role map. GLM-5.1 escalation; flash still routes cheap roles. |
| `go-minimax` | Go MiniMax | MiniMax M-series on Go (Anthropic Messages API). M2.5 routing, M2.7 workers, M3 escalation. |

The default preset is `async-economy`. If an unrecognized preset ID is given, the runtime falls back to `async-economy`.

---

## Full examples

### Basic agent config

```jsonc
{
  "$schema": "./node_modules/@artificer-ai/runtime/schema.json",
  "name": "Atlas",
  "description": "Engineering agent for the payments team",
  "preset": "quality-first",
  "identity": {
    "autoCommit": true,
    "autoPush": false
  }
}
```

### With a CLI executor

```jsonc
{
  "name": "Atlas",
  "executor": {
    "type": "cli",
    "command": "claude",
    "args": ["--print", "--dangerously-skip-permissions", "--mcp-config", "{mcpConfig}"],
    "promptMode": "stdin"
  }
}
```

### With model overrides and GitHub polling

```jsonc
{
  "name": "Atlas",
  "preset": "async-economy",
  // Override specific tiers without changing the full preset
  "models": {
    "high": "gpt-5.4"
  },
  // Override specific roles
  "roleTiers": {
    "worker": "high",
    "planner": "high"
  },
  "github": {
    // Poll the agent's PRs and notifications every 5 minutes
    "watchInterval": "5m"
  },
  "identity": {
    "autoCommit": true,
    "autoPush": true,
    "remote": "origin"
  }
}
```
