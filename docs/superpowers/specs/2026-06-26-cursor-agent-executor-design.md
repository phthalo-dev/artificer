# Cursor Agent Executor

## Goal

Add a `WorkerExecutor` abstraction to the artificer runtime so that work roles (planner, worker, reviewer) can be backed by an external agent CLI — starting with `cursor agent --print` — instead of the internal LLM + tool loop. Orchestrator and communicator roles always remain on LLM since they depend on artificer's internal tools (`get_status`, `invoke_call`, etc.).

This lets the runtime be used for real-world testing when LLM credits are low, and lays the groundwork for artificer as a meta-harness over multiple agent backends (cursor, opencode, claude-code, etc.).

## Architecture

`executeCall` in `call.ts` already builds a rich context string (`userMessage`) containing the task, workstream goal, recent work, findings, and file hints. Today that string always goes into `runToolLoop`. With this change, an optional `WorkerExecutor` on `ExecuteCallDeps` intercepts that context for work roles and routes it to the configured backend instead.

```
Engine → executeCall → buildContext (unchanged)
                     ↓
              executor present?
              ┌──── yes (work role) ────┐
              │                         │
    CursorAgentExecutor           runToolLoop
    spawn cursor agent            (existing LLM path)
    capture stdout                      │
              │                         │
              └──────────┬──────────────┘
                         ↓
                  run.output = text
                  store.saveRun(run)
                  engine.emit(run)
```

Artificer retains ownership of: workstream state, memory, findings, git commit/push, and orchestration decisions. Cursor handles: reading files, editing, running shell commands in the workspace.

## Components

### `executor.ts` (new)

```typescript
export interface ExecutorResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface WorkerExecutor {
  execute(opts: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
  }): Promise<ExecutorResult>;
}
```

### `cursor-executor.ts` (new)

Implements `WorkerExecutor`. Spawns:

```
cursor agent --print --trust --yolo --workspace {workspaceDir} {context}
```

Uses Node's `spawn` with an args array (no shell interpolation) so the context string is passed safely regardless of length. Captures stdout as `text`. On non-zero exit, throws with stderr as the error message. `usage` is returned as `{ inputTokens: 0, outputTokens: 0 }` since cursor does not report token counts.

Optional `model` constructor arg maps to `--model {model}` when provided.

### `call.ts` (modified)

`ExecuteCallDeps` gains an optional `executor?: WorkerExecutor`. In `executeCall`, after building `userMessage`:

```typescript
if (deps.executor && WORK_ROLES.has(run.role)) {
  result = await deps.executor.execute({ context: userMessage, workspaceDir, run });
} else {
  result = await runToolLoop({ ... }); // unchanged
}
```

### `engine.ts` (modified)

Reads `config.executor` at construction time and instantiates the appropriate executor. Passes it through to `executeCall` via `ExecuteCallDeps`.

### `types.ts` + `config.ts` (modified)

Add `executor` field to `ArtificerConfig`:

```typescript
export type ExecutorConfig =
  | 'llm'
  | 'cursor-agent'
  | { type: 'cursor-agent'; model?: string };
```

Defaults to `'llm'` when absent (fully backwards-compatible).

### `artificer.config.schema.json` (modified)

Add `executor` to the JSON schema so instances get validation and autocomplete.

## Configuration

In any instance's `artificer.config.json`:

```json
{ "executor": "cursor-agent" }
```

Or with a model override:

```json
{ "executor": { "type": "cursor-agent", "model": "claude-sonnet-4-5" } }
```

For atlas (`../atlas/artificer.config.json`), add `"executor": "cursor-agent"` — no other atlas-specific files are needed.

## Error Handling

- **Non-zero exit**: treat as run failure. Set `run.status = 'failed'`, surface stderr as the error message.
- **Cursor not installed / not authenticated**: detect at executor construction time by checking `cursor agent status`. Fail fast with a clear message before any workstream runs.
- **Timeout**: 5-minute hard kill (`SIGKILL`), same as the existing shell tool.

## Future Evolution

The `WorkerExecutor` interface is intentionally minimal so additional backends slot in without touching core logic. A `ShellExecutor` could accept a command template (`"opencode run --workspace {workspace} {task}"`) and make any CLI agent configurable from `artificer.config.json` with no runtime changes per backend.
