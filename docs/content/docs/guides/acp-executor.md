---
title: Using the ACP Executor
description: Run OpenCode, Codex, or any Agent Client Protocol agent, as Artificer's worker executor with dangerous shell commands, mutating fetches and out-of-workspace writes policed by Artificer.
---

# Using the ACP Executor

The [Agent Client Protocol](https://agentclientprotocol.com) (ACP) is a JSON-RPC protocol over stdio that lets a client drive a coding agent. Artificer's `acp` executor spawns an ACP agent, points its session at the workspace, sends it the role prompt, and answers the agent's permission requests: dangerous shell commands and mutating fetches go through Artificer's tool policy, while reviewer writes and out-of-workspace writes are denied. Status is reported back through the same `report_status` MCP tool the other executors use.

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
- **First run downloads the adapter.** The preset launches `npx -y @agentclientprotocol/codex-acp@2.6.0`, so `npx` must be on PATH and the first run needs network access. npm config is pinned for this launch: `npm_config_registry=https://registry.npmjs.org/` and `npm_config_userconfig` pointing at an empty Artificer-owned file (`<exec dir>/acp/npmrc`), both set after your `env`, so neither a home nor a repo `.npmrc` can redirect the download.
- **Runs in `read-only` mode.** Read-only commands (such as `ls`) run inside Codex's own sandbox without asking. Writes, network access and MCP calls are escalated to Artificer as permission requests, which are decided as described below. The mode is forced and cannot be loosened from `executor.env` (the preset also forces `NO_BROWSER=1` and the API-key auth request).
- **Artificer-owned `CODEX_HOME`.** Codex state lives in `<exec dir>/acp/codex-home` (mode `0700`). It is a single directory **shared by all workstreams and runs**, and it persists so resume works. Codex stores the API key there at rest, in `auth.json`. Your `~/.codex` and any ChatGPT login there are never used. Without an isolated home, the adapter silently uses whatever `~/.codex/auth.json` holds, so a bot could bill (or act as) a person's ChatGPT account.
- **The home is reset on every spawn.** Because the agent can write to it and every later run reads it, Artificer rewrites `config.toml` to empty and removes `rules/`, `prompts/`, `skills/`, `AGENTS.md` and `AGENTS.override.md` before each launch; `auth.json` and session storage are kept. Agent shell commands that mention Artificer's agent state directory (`<exec dir>/acp`, including its `~/` and `$HOME/` spellings), or run with a cwd inside it, and writes into it are denied (`touches Artificer agent state`). This is a string check, so a command that builds the path indirectly is not caught; the per-spawn reset is the backstop.
- **Repo `.codex/config.toml` is not loaded.** Codex loads a project config only for trusted projects, and the isolated home has no trust entries. In testing, even trusting the project and adding `sandbox_mode = "danger-full-access"` and `approval_policy = "never"` to the repo config did not change gating: permission requests were still sent.
- **MCP approvals.** Codex asks permission for MCP tool calls. Artificer allows these only for its own `artificer-status` server (which is how `report_status` works). MCP calls to any other server go through the tool policy and are denied unless a rule allows them.
- **Escalated commands run outside Codex's sandbox.** When Artificer allows an escalated command, Codex runs it unsandboxed. Shell commands that are not on the dangerous-command list are allowed, and that includes network commands such as a GET fetch with `curl` and any write the denylist does not recognise. For Codex, Artificer's denylist is therefore the only boundary for escalated commands: what it does not catch runs with the runtime user's full access.
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
- **Writes with no path** (no locations on the request or the tracked call) are denied (`no path to evaluate`).
- **MCP approvals** are recognised only by the adapter's flag (`_meta.is_mcp_tool_approval` on the request, or `_meta.is_mcp_tool_call` on the tracked tool call), never from the shape of the input, and never when the request carries a shell command or is a write kind; such requests keep their normal shell or write checks. A flagged approval is allowed once for the `artificer-status` server. For other servers it is evaluated as tool `mcp:<server>.<tool>` through the tool policy and denied unless a rule allows it.
- **Any other kind of request**, including reads, is allowed. Reads are not gated at all.

Two rules apply to every agent:

- **Fill-in.** Some agents (Codex) send a permission request without details and describe the call in an earlier tool-call update with the same `toolCallId`. Before deciding, Artificer fills the request's missing title, kind, input and locations from that tracked call, and request fields that are present win.
- **Fail closed.** An `execute` request is judged on `rawInput.command`. The title is used as the command only when the request itself carried it; a title filled in from tracking is a label, never a command. If no command is left, the request is denied (`no command to evaluate`) rather than treated as harmless.
- **The agent never starts in the workspace.** The agent process is started from a fresh Artificer-owned directory under `<exec dir>/acp/run/` (mode `0700`, removed after the run); the workspace reaches the agent only as the ACP session `cwd`. So nothing in the repo, such as a `node_modules` copy of the adapter or a `.npmrc`, can change which program the launch command runs. A relative custom `command` (for example `./bin/agent`) is still resolved against the workspace.

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

A custom agent must use the session `cwd` it is given rather than its own process directory, which is not the workspace. Custom commands are **not policy-gated** unless the agent itself sends `session/request_permission`; Artificer cannot force it to ask. The quota account is `acp:<basename(command)>`, or `acp:custom:<basename>` when the basename equals a preset id, so running `command: "opencode"` yourself is never recorded as the certified preset (and gets none of its enforcement).

## Live smoke test

`packages/runtime/src/engine/acp-opencode.live.test.ts` runs the preset against a real OpenCode and checks that `rm -rf build` is denied through a permission request, `build/out.txt` still exists afterwards, and status is still reported. A second case repeats this in a repo whose `opencode.json` sets an agent-level `allow`, to check that project config cannot bypass the ask block. Both are skipped unless you opt in (they spend a few small model calls):

```bash
ARTIFICER_ACP_LIVE=opencode pnpm --filter @artificer-ai/runtime test
```

`packages/runtime/src/engine/acp-codex.live.test.ts` does the same for Codex, plus a case with a hostile repo `.codex/config.toml`. It needs `ARTIFICER_ACP_LIVE=codex`, `CODEX_API_KEY` (or `OPENAI_API_KEY`) and `npx`, and uses a temporary state directory so your `~/.codex` is untouched.

See the [config reference](/docs/reference/config) for every field.
