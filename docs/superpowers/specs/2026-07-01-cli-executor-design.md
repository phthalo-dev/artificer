# Generic CLI Executor Design

**Date:** 2026-07-01
**Status:** Approved

## Problem

The runtime supports two hardcoded worker executor backends — `ClaudeCodeExecutor` and `CursorAgentExecutor`. Adding a new local CLI agent (e.g. Aider, Codex, Goose) requires writing a new executor class and extending the closed `ExecutorConfig` union. The goal is to make execution configurable for any MCP-capable local CLI without code changes.

## Scope

- Add a `{ type: 'cli'; ... }` variant to `ExecutorConfig`
- Add a `CliExecutor` class that handles the full spawn lifecycle
- Wire `buildExecutor()` to instantiate it
- No changes to existing executors, config loading, roles, or provider routing

## Config Shape

A new discriminated-union member is added to `ExecutorConfig` in `packages/runtime/src/api/types.ts`:

```typescript
export type ExecutorConfig =
  | 'llm'
  | 'cursor-agent'
  | 'claude-code'
  | { type: 'cursor-agent'; model?: string }
  | { type: 'claude-code'; model?: string }
  | { type: 'cli'; command: string; args: string[]; promptMode: 'stdin' | 'arg'; model?: string; timeout?: number; mcpConfigPath?: string };
```

### Fields

| Field | Required | Description |
|---|---|---|
| `command` | yes | Binary to spawn (e.g. `"aider"`, `"goose"`) |
| `args` | yes | Arg template array; may contain placeholders |
| `promptMode` | yes | `"stdin"` — context written to stdin; `"arg"` — context via `{prompt}` placeholder |
| `model` | no | Model string passed into the `{model}` placeholder |
| `timeout` | no | Per-run timeout in ms; default 10 minutes |
| `mcpConfigPath` | no | Workspace-relative path where the MCP config file is written; defaults to `.artificer-mcp.json`. Use when the CLI reads from a fixed location (e.g. `.qwen/settings.json`). Parent directories are created automatically. |

### Placeholders

| Placeholder | Value |
|---|---|
| `{workspaceDir}` | Absolute path to the run workspace directory |
| `{mcpConfig}` | Absolute path to the written MCP status server config file |
| `{model}` | The configured model string |
| `{prompt}` | The context/prompt (only used when `promptMode: "arg"`) |

**Optional placeholder dropping:** when an arg is exactly a single placeholder (e.g. `"{model}"`) and the resolved value is empty or unset, that arg is dropped. If the immediately preceding pushed arg starts with `-`, it is also dropped. This allows `["--model", "{model}"]` to cleanly collapse when no model is set. Mixed-content args like `"--model={model}"` receive simple string substitution with no dropping.

### Example `artificer.config.json`

```json
{
  "executor": {
    "type": "cli",
    "command": "aider",
    "args": ["--yes-always", "--mcp-config", "{mcpConfig}", "--model", "{model}"],
    "promptMode": "stdin"
  }
}
```

Cursor equivalent expressed as a generic CLI (for reference):

```json
{
  "executor": {
    "type": "cli",
    "command": "cursor",
    "args": ["agent", "--print", "--trust", "--yolo", "--approve-mcps", "--workspace", "{workspaceDir}", "--model", "{model}", "{prompt}"],
    "promptMode": "arg"
  }
}
```

## Implementation

### New file: `packages/runtime/src/engine/cli-executor.ts`

`CliExecutor` implements `WorkerExecutor`. Its `name` is `cli:<command>`.

**Execution flow:**
1. Resolve MCP config write path: `path.join(workspaceDir, cfg.mcpConfigPath ?? '.artificer-mcp.json')`. Create parent dirs if needed (`fs.mkdirSync(..., { recursive: true })`).
2. Write MCP status server config JSON to that path. Delete any existing `.artificer-status.json` from a prior run.
3. Call `resolveArgs()` to expand the template
4. `spawn(command, resolvedArgs, { cwd: workspaceDir, stdio: ['pipe', 'pipe', 'pipe'] })`
5. If `promptMode === 'stdin'`: write context to `child.stdin`, then close it. Otherwise close stdin immediately.
6. Collect stdout and stderr into buffers
7. Set a kill timer at `timeout` ms
8. On process close:
   - Parse `.artificer-status.json` if present (same logic as existing executors: handles both `submit_review` and `report_status` tool shapes)
   - Reject on non-zero exit code with stderr in the error message
   - Resolve with `ExecutorResult` on success

**`resolveArgs(template, values)` — pure module-scope function:**

```
for each arg in template:
  if arg matches /^{(\w+)}$/ (pure placeholder):
    resolve value from values map
    if value is empty:
      pop previous result arg if it starts with '-'
      skip (don't push empty)
    else:
      push value
  else:
    substitute all {key} occurrences via regex replace
    push result
```

### Modified file: `packages/runtime/src/engine/engine.ts`

Add one branch to `buildExecutor()`:

```typescript
if (config.type === 'cli') return new CliExecutor(config);
```

## Files Changed

| File | Change |
|---|---|
| `packages/runtime/src/api/types.ts` | Add `{ type: 'cli'; ... }` to `ExecutorConfig` union |
| `packages/runtime/src/engine/cli-executor.ts` | New file — `CliExecutor` class and `resolveArgs` helper |
| `packages/runtime/src/engine/engine.ts` | One new branch in `buildExecutor()` |

## Validation: Testing with Qwen Code

Qwen Code (by QwenLM) is an open-source CLI agent with MCP support and a headless mode — a good first live test of the generic executor.

**Headless invocation:** `qwen --prompt "<text>"` runs non-interactively and exits. Stdin mode is also supported.

**MCP config:** Qwen Code reads MCP servers from `mcpServers` in `.qwen/settings.json` at the project root (or the global `~/.qwen/settings.json`). It uses the same JSON `{ mcpServers: { ... } }` format as Claude Code. There is no `--mcp-config` flag yet (open feature request), so `mcpConfigPath` must point to `.qwen/settings.json`.

**Config:**

```json
{
  "executor": {
    "type": "cli",
    "command": "qwen",
    "args": ["--prompt", "{prompt}"],
    "promptMode": "arg",
    "mcpConfigPath": ".qwen/settings.json"
  }
}
```

The executor writes the MCP config to `{workspaceDir}/.qwen/settings.json`, creating the `.qwen/` directory if needed. Qwen Code picks it up automatically on startup because it reads from the project root.

**Result:** The design works for Qwen Code with only the `mcpConfigPath` field — no format changes, no new code paths. This validates that the `mcpConfigPath` field correctly handles CLIs that expect a fixed-location config.

**Open question:** Qwen Code's permission-skip flag (equivalent to Claude Code's `--dangerously-skip-permissions`) needs confirmation before production use — the exact flag name requires checking `qwen --help`.

---

## Validation: Testing with Goose

Goose (by Block) is an MCP-capable open-source CLI agent and a good first test for the generic executor. The intended config:

```json
{
  "executor": {
    "type": "cli",
    "command": "goose",
    "args": ["run", "--text", "{prompt}"],
    "promptMode": "arg"
  }
}
```

Goose's headless mode is invoked via `goose run`. The `-t` / `--text` flag passes a prompt directly; stdin is the alternative (`promptMode: "stdin"` with no `{prompt}` in args).

### Gaps surfaced by Goose

Testing with Goose reveals two issues out of scope for this implementation but worth noting as future work:

**1. Global-only MCP config location**

Goose reads extensions from `~/.config/goose/config.yaml` — a global path, not a per-workspace file. Unlike Qwen Code (which supports project-level `.qwen/settings.json`), `mcpConfigPath` cannot help here: writing to a global path means concurrent Goose runs would contend on the same file. This is a fundamental limitation of Goose's design.

**2. YAML config format**

Goose's config uses a YAML `extensions:` array rather than the JSON `{ mcpServers: {...} }` format our executor writes. Supporting Goose fully would require a configurable MCP config format (or a Goose-specific converter).

### Conclusion

The generic `CliExecutor` design is validated for CLIs that use a per-workspace JSON `mcpServers` config — either via a `--mcp-config` flag or a project-level config file (Qwen Code's `.qwen/settings.json`). Goose support is blocked by its global-only config location and YAML format; both are deferred.

## Out of Scope

- Configurable MCP config file format (always writes JSON `{ mcpServers: {...} }`)
- Shell-mode execution (string command with env vars)
- Modifying or deprecating the existing `cursor-agent` and `claude-code` executor types
- Full Goose support (global-only config location + YAML format; tracked as future work)
