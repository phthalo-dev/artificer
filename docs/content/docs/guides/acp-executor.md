---
title: Using the ACP Executor
description: Run OpenCode, Codex, or any Agent Client Protocol agent, as Artificer's worker executor with dangerous shell commands, mutating fetches and out-of-workspace writes policed by Artificer.
---

# Using the ACP Executor

The [Agent Client Protocol](https://agentclientprotocol.com) (ACP) is a JSON-RPC protocol over stdio that lets a client drive a coding agent. Artificer's `acp` executor spawns an ACP agent in the workspace, sends it the role prompt, and answers the agent's permission requests: dangerous shell commands and mutating fetches go through Artificer's tool policy, while reviewer writes and out-of-workspace writes are denied. Status is reported back through the same `report_status` MCP tool the other executors use.

## The `opencode` preset

OpenCode is a certified preset (verified against OpenCode **2.0.32**). [Codex](#the-codex-preset) is the other.

```json
{
  "executor": {
    "type": "acp",
    "agent": "opencode",
    "model": "opencode/claude-sonnet-5-5",
    "env": { "OPENCODE_API_KEY": "..." }
  }
}
```

- `agent` selects the preset (it launches `opencode acp`). It is mutually exclusive with `command`, and `args` cannot be set with it: a certified preset keeps its verified launch line.
- `model` is optional. Artificer selects it through ACP's `session/set_config_option`. If the agent has no model option, or doesn't offer the model you named, the run fails with the available values **before** the prompt is sent, so no tokens are spent on the wrong model.
- `env` adds environment variables for the agent process. `OPENCODE_CONFIG_CONTENT`, if set, must be valid JSON; the API rejects the executor otherwise.
- Sessions resume across turns (`session/resume`), so conversations keep context.
- The quota account is `acp:opencode`, and the agent's reported token usage is recorded.

## The `codex` preset

Codex is certified through the `@agentclientprotocol/codex-acp` adapter, verified against version **2.6.0**.

```json
{
  "executor": {
    "type": "acp",
    "agent": "codex"
  }
}
```

- **API-key auth only.** Set `CODEX_API_KEY` or `OPENAI_API_KEY`. Artificer checks `executor.env` first and then the runtime's process environment, and refuses to start the run if neither is set. A key passed through `executor.env` is stored with the workstream on disk, although the API, the event stream and traces show it as `[redacted]`. Prefer setting the key in the environment of the runtime process.
- **First run downloads the adapter.** The preset launches `npx -y @agentclientprotocol/codex-acp@2.6.0`, so `npx` must be on PATH and the first run needs network access.
- **Runs in `read-only` mode.** Read-only commands (such as `ls`) run inside Codex's own sandbox without asking. Writes, network access and MCP calls are escalated to Artificer as permission requests, which are decided as described below. The mode is forced and cannot be loosened from `executor.env` (the preset also forces `NO_BROWSER=1` and the API-key auth request).
- **Artificer-owned `CODEX_HOME`.** Codex state lives in `acp/codex-home` under the workstream's state directory, created with mode `0700`, and it persists so resume works. Your `~/.codex` and any ChatGPT login there are never used. Without an isolated home, the adapter silently uses whatever `~/.codex/auth.json` holds, so a bot could bill (or act as) a person's ChatGPT account. The isolated home also has no project trust entries, so a repo's own `.codex/config.toml` is not loaded. Even when a project was trusted in testing, a repo config of `sandbox_mode = "danger-full-access"` and `approval_policy = "never"` did not stop permission requests.
- **MCP approvals.** Codex asks permission for MCP tool calls. Artificer allows these only for its own `artificer-status` server (which is how `report_status` works). MCP calls to any other server go through the tool policy and are denied unless a rule allows them.
- Sessions resume across processes. The `model` option is re-applied after resume.

## How permission enforcement works

By default OpenCode does not ask before running commands: it ran `rm -rf build` unasked in testing. The preset therefore forces this inline config through `OPENCODE_CONFIG_CONTENT`:

```json
{"permission":{"bash":"ask","edit":"ask","webfetch":"ask","external_directory":"ask"}}
```

If you set your own `OPENCODE_CONFIG_CONTENT`, it is merged, but the preset's `permission` block always wins, so you cannot loosen it there.

The inline config overrides a repo's **top-level** `permission` block, but not **agent-level** permissions: an `agent.<name>.permission` block in the repo's `opencode.json`, or `permission:` frontmatter in `.opencode/agent/*.md`, is applied after the top-level rules and wins. A repo with `{"agent":{"build":{"permission":{"bash":"allow"}}}}` made OpenCode run shell commands without asking. Because workers may write inside the workspace, a prompt-injected worker could write such a file and run ungated on the next turn. The preset therefore also sets `OPENCODE_DISABLE_PROJECT_CONFIG=1` (after your `env`, so it cannot be turned off), which was verified live to restore permission requests in both cases.

Consequences and limits:

- OpenCode ignores the repo's own `opencode.json` and `.opencode/` config for Artificer runs. Put settings you need into `executor.env.OPENCODE_CONFIG_CONTENT` instead.
- Your own global OpenCode config (`~/.config/opencode`) and any `OPENCODE_CONFIG` or `OPENCODE_CONFIG_DIR` in the environment Artificer runs in are outside Artificer's control, and agent-level permissions there can loosen enforcement. Keep them free of `allow` rules for the agent OpenCode uses.

With that config OpenCode sends a `session/request_permission` for shell commands and writes (including writes outside the workspace); this was verified in recordings. Web fetch and `external_directory` are also configured to `ask`, but those were not exercised. Artificer decides each request as follows, and records every decision as an `acp:permission` tool call. Requests that arrive while Artificer is cancelling are answered `cancelled`.

- **Shell commands** are allowed unless they match the dangerous-command check, and those go through the tool policy. For a reviewer (or a custom role whose base role is reviewer), detected mutating commands (`sed -i`, `patch`, redirects, `git checkout`/`reset`, `rm`/`mv`/`tee` and similar) are denied. `git stash` is denied for other roles, and `git clone` into a location outside the workspace is denied.
- **Web fetches** are allowed for GET and HEAD and policy-gated otherwise.
- **Writes** (edit, delete, move) are allowed unless the role is a reviewer (or a custom role whose base role is reviewer) or a path resolves outside the workspace. Writes are not gated by policy rules.
- **MCP approvals** (flagged by the adapter) are allowed once for the `artificer-status` server. For other servers they are evaluated as tool `mcp:<server>.<tool>` through the tool policy and denied unless a rule allows them.
- **Any other kind of request**, including reads, is allowed.

Two rules apply to every agent:

- **Fill-in.** Some agents (Codex) send a permission request without details and describe the call in an earlier tool-call update with the same `toolCallId`. Before deciding, Artificer fills the request's missing title, kind, input and locations from that tracked call, and request fields that are present win.
- **Fail closed.** An `execute` request whose command still cannot be determined after fill-in is denied (`no command to evaluate`) rather than treated as harmless.

**Not covered:**

- With OpenCode, MCP tool calls (including `report_status`) are not permission-gated, because OpenCode does not ask for them.
- File reads are not gated.

## A denial ends the agent's turn

When Artificer rejects a request, OpenCode and Codex end its turn with a `cancelled` stop reason even though Artificer never cancelled. Artificer treats this as a stop, not a user cancellation: the run completes with the text suffix `[agent stopped: cancelled]`. Cancels and timeouts that Artificer initiates still fail the run.

## Signing in on a headless host

OpenCode needs credentials in the environment where Artificer runs. Either run `opencode auth login` once as the same user, or supply an API key through `executor.env` or the process environment.

## Custom ACP commands

Any other ACP agent can be run with `command` and `args`:

```json
{ "executor": { "type": "acp", "command": "my-agent", "args": ["--acp"] } }
```

Custom commands are **not policy-gated** unless the agent itself sends `session/request_permission`; Artificer cannot force it to ask. The quota account is `acp:<basename(command)>`, or `acp:custom:<basename>` when the basename equals a preset id, so running `command: "opencode"` yourself is never recorded as the certified preset (and gets none of its enforcement).

## Live smoke test

`packages/runtime/src/engine/acp-opencode.live.test.ts` runs the preset against a real OpenCode and checks that `rm -rf build` is denied through a permission request, `build/out.txt` still exists afterwards, and status is still reported. A second case repeats this in a repo whose `opencode.json` sets an agent-level `allow`, to check that project config cannot bypass the ask block. Both are skipped unless you opt in (they spend a few small model calls):

```bash
ARTIFICER_ACP_LIVE=opencode pnpm --filter @artificer-ai/runtime test
```

`packages/runtime/src/engine/acp-codex.live.test.ts` does the same for Codex, plus a case with a hostile repo `.codex/config.toml`. It needs `ARTIFICER_ACP_LIVE=codex`, `CODEX_API_KEY` (or `OPENAI_API_KEY`) and `npx`, and uses a temporary state directory so your `~/.codex` is untouched.

See the [config reference](/docs/reference/config) for every field.
