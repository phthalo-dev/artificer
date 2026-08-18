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

1. Writes `{workspaceDir}/opencode.json` with two blocks:
   - `mcp` — registers the local `artificer-status` MCP server (`{ "type": "local", "command": [...], "enabled": true }`). opencode discovers this file automatically by walking up from its working directory; there's no `--mcp-config` flag to pass a path explicitly, unlike Claude Code.
   - `permission` — the sandbox policy described under [Sandboxing](#sandboxing) below: an explicit per-category allow-list, a `bash` allow-list that denies anything unlisted, explicit allows for the two MCP tools, and `external_directory: "deny"` last.
2. Removes the `origin` remote from `{workspaceDir}/repo` if that clone exists, so nothing inside the sandbox can push back to the repo it was cloned from.
3. Spawns `opencode run "<task>" --dir <workspaceDir> [--model <model>]`.
4. opencode reads the MCP config at startup and connects to the Artificer status server.
5. When opencode calls `report_status` or `submit_review` via MCP, Artificer captures the result and advances the workstream state machine.
6. On process exit, Artificer reads the result and continues orchestration as normal.

### Sandboxing

opencode's non-interactive mode auto-*rejects* every tool-call permission prompt it can't resolve from config — unlike some other CLIs that default to allow. Earlier versions of this executor handled that by passing `--dangerously-skip-permissions`, which approves *everything*, including opencode acting on an absolute path it read out of its own prompt. **Do not reintroduce that flag.** It is replaced by an explicit `permission` block:

- **`external_directory: "deny"`** — opencode consults this permission whenever a path-bearing tool (`read`, `write`, `edit`, `glob`, `grep`, `list`, `lsp`) or one of its known file commands (`cat`, `cp`, `mv`, `rm`, `mkdir`, `touch`, …) is asked to touch a path outside `--dir`. Denying it is what stops opencode from editing the *original* repo at the absolute `repoUrl` path instead of its sandboxed clone.
- **A `bash` allow-list** — `external_directory` is *never* consulted for arbitrary bash arguments, so bash needs its own policy. The config denies `bash` by default and allows a specific set of commands: read/inspect/search tools, workspace file manipulation, local git operations, and the common test/build runners. `git push`, `git remote`, `curl`, `wget`, `ssh`, `scp`, `rsync`, `sudo` and bare `sh -c` are not in the allow-list. opencode parses the command string and checks each parsed command separately, so `git status && curl …` is rejected on the `curl` half.

  Note that *not in the allow-list* is weaker than *cannot run*. Programs whose arguments name another program to execute are excluded for exactly this reason — `env` (`env curl …`), `find` (`-exec`/`-execdir`/`-ok`/`-okdir`), `fd` (`-x`), and `make` (arbitrary recipes) are all absent, because each would launch an unlisted binary under a listed pattern. They can't be salvaged with narrower rules: opencode's pattern language has only `*` and `?`, so a deny rule like `find * -exec*` is trivially evaded by `find . '-exec' curl …`, which still matches `find *`. Use the `glob`, `list` and `grep` tools (or `rg`) for search instead. Some commands that *are* allowed still have flags that invoke other programs — `git rebase -x`, `git config` writing `diff.external` for a later git command to run, `rg --pre`, `sort --compress-program`. They're kept because a coding worker needs them.
- **No `origin` remote** — defense in depth for the one bash vector that needs no path at all. The workspace clone's `origin` points at the real repo, so `git push origin HEAD` would write straight back to it. The executor removes the remote before opencode starts.

**What this does not guarantee.** The allow-list closes opportunistic and naive escapes, including the exact failure mode this executor originally shipped with. It does *not* make escape impossible, and that is not a theoretical caveat:

- opencode's own bash tool documents its command-argument path scan as "advisory only".
- Shell redirection targets are not path-checked at all. Every allow-list entry accepts arguments, so any of them can carry `> /somewhere/outside`. This was confirmed empirically.
- Allowing a project's tests to run means allowing `node`, `python` and `npm run` — arbitrary code execution by definition. An agent that is determined or prompt-injected can write a script inside the workspace and execute it.

Treat the opencode executor as *reducing accident and opportunistic misbehaviour*, not as a security boundary. If you need a real boundary, run Artificer itself inside an OS-level sandbox or container.

### Timeout

Worker runs default to 10 minutes, matching the Claude Code executor. This isn't currently configurable per-executor the way the generic `cli` executor's `timeout` field is — file an issue if you need a longer window for large tasks.

## 5. Verify it's working

Start Artificer and send a message that triggers a workstream. Check the run log in the Artificer UI — worker runs should show `executor: opencode`, and the output should come from opencode's response. If `report_status` was called, you'll see a structured status and summary rather than raw stdout.

## Known limitations

- **No usage stats.** opencode's default (non-JSON) output doesn't surface token usage, so `usage` is always reported as `{ inputTokens: 0, outputTokens: 0 }` — cost tracking for opencode-executed work isn't currently possible.
- **`opencode.json` is overwritten on every run.** Each workstream runs in a fresh cloned workspace, so this is normally harmless, but don't hand-edit MCP config into a workspace opencode will reuse across runs.
- **Requires local opencode auth already configured** (`opencode auth`/`opencode providers`) — Artificer does not manage opencode's own provider credentials.
- **The sandbox is not a security boundary.** See [Sandboxing](#sandboxing). It blocks writes to absolute paths outside the workspace via opencode's path-bearing tools, and blocks unlisted shell commands — but shell redirection from an allowed command, and any code run through an allowed test runner, can still reach the rest of the filesystem.
- **A permissive global opencode config can widen the sandbox.** opencode merges your global `~/.config/opencode/opencode.json` before this executor's project-level config, and for a permission category present in both, this executor's value wins. But the merged key keeps the *global* config's position in the rule list, and opencode resolves permissions "last matching rule wins". So a global config that declares `permission.external_directory` **and then** a `permission."*"` wildcard will hoist this executor's `deny` above that wildcard and defeat it. Verified against opencode 1.17.3. If you use the opencode executor, don't put a `"*"` wildcard in your global opencode `permission` block.

## Related docs

- [Custom CLI Executors](./custom-cli-executor.md) — the generic `cli` executor for CLIs that don't need a dedicated integration
- [Setting Up an Agent Identity Repo](./agent-identity-setup.md) — configure your agent project before adding an executor
