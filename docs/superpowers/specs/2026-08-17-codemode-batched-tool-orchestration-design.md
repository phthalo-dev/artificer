# Codemode-style batched tool orchestration — Design

**Date:** 2026-08-17
**Status:** Proposed
**Component:** `packages/runtime`
**Related:** [Artificer vs. opencode comparison](../../research/2026-08-14-opencode-comparison.md) (Tier 1 borrow #1)

## Purpose

Let the worker and orchestrator, in one model turn, run a small JavaScript program that sequences and concurrently calls that role’s existing tools. Today `runToolLoop` is one tool call per model turn; repetitive multi-file work pays a round-trip per call. This adds an opt-in `execute` tool. It does not replace the tool loop, hide sibling tools, or adopt opencode’s Effect runtime.

## Decisions already locked

- **Opt-in `execute` tool** beside the existing catalog, not a replacement of it.
- **QuickJS-in-WASM** (`quickjs-emscripten`, **sync** build) as the guest engine. Artificer does not own a JS interpreter.
- **Promise bridge, not Asyncify.** Asyncify allows only one in-flight async host call per WASM module, which would serialize `Promise.all`. Each `tools.<name>(args)` returns a guest promise via `context.newPromise()`; Node runs the real `ToolDef.handler`; on settle the host resolves the guest promise and calls `runtime.executePendingJobs()`.
- Worker and orchestrator only. Planner, reviewer, communicator, librarian, and external CLI executors are unchanged.

## Architecture

```
model ──execute({ code })──▶ createExecuteTool
                                │
                                ▼
                         codemode runtime (sync QuickJS WASM)
                                │
                                ├─ frozen `tools` object (JSON in / JSON-string out)
                                ├─ interrupt handler (timeoutMs)
                                ├─ admit/queue inner calls (maxToolCalls, concurrency 8)
                                └─ return { ok, value|error, logs?, truncated?, toolCalls }
                                                │
                                                ▼
                                      runToolLoop (outer execute result)
```

`execute` is wired in `toolsForRole` **after** built-ins and identity-repo custom tools. The sibling list is the program’s entire authority: every tool that role already has, **minus `execute` itself** (no nesting). `execute` is a reserved tool name.

External `WorkerExecutor` paths (Claude Code, Cursor, CLI, opencode) never see this tool; they keep their own loops.

### Isolation and authority

- Guest has no `fs`, `process`, `require`, network, or host objects. Guest `eval` / `Function` stay inside the WASM heap.
- Values cross the boundary as JSON-safe data only (`vm.dump` then `JSON.stringify` / `JSON.parse`). Functions, cycles, and host handles are `InvalidDataValue`.
- Authority is the role’s existing tools. `run_shell` inside `execute` is still `run_shell`. The guest cannot gain new capabilities by generating code.
- Inner tool outputs stay in the guest until the program returns them. Result spill remains a **model-context** concern on the outer `execute` result; intermediates are not spilled.

### Concurrency

`newFunction` callbacks are synchronous. A host-side wait for a concurrency slot would block the Node event loop and deadlock in-flight guest promises.

Every inner call **immediately** returns a guest promise. A host queue starts at most **8** `ToolDef.handler` invocations at once; the 9th waits on the Node side until a slot frees, without blocking QuickJS. This is a fixed constant, not a knob.

## Components

| Unit | Path | Responsibility |
|---|---|---|
| Runtime | `packages/runtime/src/codemode/runtime.ts` | Create/dispose sync QuickJS context, wrap `code` as an async IIFE, interrupt/memory limits, `resolvePromise` + `executePendingJobs`, capture `console.log`, serialize the model-facing result |
| Bridge | `packages/runtime/src/codemode/bridge.ts` | Install `tools.<name>` functions, JSON-copy args, admit/queue handlers, reject guest promises on tool failure |
| Tool factory | `packages/runtime/src/tools/execute.ts` | `createExecuteTool(ctx, siblings, limits): ToolDef` — description inlines sibling signatures; handler calls the runtime |
| Registry | `packages/runtime/src/tools/registry.ts` | Append `execute` for `worker` and `orchestrator` after custom tools |
| Context | `packages/runtime/src/context.ts` | Optional `onToolCall` so inner invocations use the same activity-feed path as `runToolLoop` |
| Config | `packages/runtime/src/config.ts` | `codemode` limits on `RuntimeConfig`, loaded from env |

Public types for the runtime result live next to the runtime (`CodemodeResult`, `CodemodeDiagnostic`). They are not exported from `@artificer-ai/runtime` in v1.

## `execute` contract

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "Body of an async function. `return` is the result. Call tools as `await tools.read_file({ path: \"...\" })`. Independent work: `await Promise.all([...])`."
    }
  },
  "required": ["code"]
}
```

The host wraps `code` as:

```js
(async () => {
  ${code}
})()
```

Empty `code` is a parse/execution failure, not success-with-null.

**Guest-visible tools.** `tools.read_file`, `tools.edit_file`, … — one property per sibling `ToolDef.name` (snake_case identifiers are valid JS). Each function:

1. JSON-copies its argument object (mutating it in the guest does not mutate host state).
2. Returns a guest `Promise` that fulfills to the handler’s **string** (no silent `JSON.parse`). The program parses JSON if it needs structure.
3. **Rejects** if the handler throws, so `try/catch` works.

Missing names are not installed. `tools.not_a_tool` is `undefined`; calling it throws in-guest (catchable). If that throw is uncaught, the outer result is `ExecutionFailure` with a message that names the tool. There is no separate `UnknownTool` diagnostic kind.

**Console.** Inject a `console.log` / `console.warn` / `console.error` that appends stringified arguments onto `logs`. Other `console` methods are absent.

**Model-facing output** (the string `runToolLoop` feeds back), JSON:

```ts
type ExecuteOutput =
  | {
      ok: true;
      value: unknown; // JSON-safe; `undefined` becomes `null`
      logs?: string[];
      truncated?: true;
      toolCalls: string[]; // admitted inner names, in order; no args
    }
  | {
      ok: false;
      error: { kind: DiagnosticKind; message: string };
      logs?: string[];
      truncated?: true;
      toolCalls: string[];
    };

type DiagnosticKind =
  | 'ParseError'
  | 'InvalidDataValue'
  | 'ToolCallLimitExceeded'
  | 'TimeoutExceeded'
  | 'ExecutionFailure';
```

Host stack traces never appear in `message`. Inner tool arguments already go to the activity feed via `onToolCall`; they are omitted from `toolCalls` to keep the model-facing payload small.

**Description catalog.** Inline every sibling as a short JSDoc-style signature (`tools.<name>(input): Promise<string>` plus the existing tool `description` and JSON-schema property list). Worker/orchestrator catalogs are small; v1 has no `$codemode.search` and no token budget.

**Prompt hint.** Add one sentence to the worker and orchestrator system prompts: for several independent or sequential tool calls, prefer `execute` over one-at-a-time calls. The tool description holds the syntax; prompts do not duplicate a tutorial.

## Observability

`ToolContext` gains:

```ts
onToolCall?: (invocation: ToolInvocation) => void;
```

`executeCall` sets this to the same callback `runToolLoop` already uses (push onto `run.toolCalls`, emit `kind: 'tool'`, save run). The bridge calls it when an inner handler settles (success or error), so the activity feed is not a black box. The outer `execute` invocation is still recorded by `runToolLoop` as usual.

## Limits (host policy)

Opencode leaves these unset; Artificer always sets them.

| Limit | Default | Env | Notes |
|---|---|---|---|
| `timeoutMs` | `120_000` | `RUNTIME_CODEMODE_TIMEOUT_MS` | QuickJS `setInterruptHandler` / `shouldInterruptAfterDeadline`. Stops admitting new calls and fails the guest; does **not** SIGKILL in-flight `run_shell` (shell already has its own timeout). |
| `maxToolCalls` | `32` | `RUNTIME_CODEMODE_MAX_TOOL_CALLS` | Count of **admitted** inner calls (queued + started). The 33rd is `ToolCallLimitExceeded`. Separate from `maxIterationsPerCall` (outer model turns). |
| `maxOutputBytes` | `12_000` | `RUNTIME_CODEMODE_MAX_OUTPUT_BYTES` | UTF-8 size of serialized `value` plus `logs`. Oversize → still `ok: true` with `truncated: true` and a truncated payload. Matches `RUNTIME_TOOL_RESULT_MAX_CHARS` so the model sees a structured truncate rather than a spill pointer. |
| concurrency | `8` | — | Fixed. |
| WASM memory | `32 * 1024 * 1024` | — | `runtime.setMemoryLimit`. Fixed. |

Loaded onto `RuntimeConfig.codemode: { timeoutMs, maxToolCalls, maxOutputBytes }`. Not added to `artificer.config.json` in v1 (same pattern as `RUNTIME_MAX_RUN_MS`).

Invalid env values (non-integers, `timeoutMs < 1`, negative counts) fall back to the defaults and log a warning, matching `identity.pullInterval`’s “warn and continue” style.

## Error handling

| Kind | When | Guest / host |
|---|---|---|
| `ParseError` | Empty code, QuickJS syntax error, wrap/eval failure | Failure result; no tools run |
| `InvalidDataValue` | Non-JSON return value, cycles, leaking handles | Failure |
| `ToolCallLimitExceeded` | Admit would exceed `maxToolCalls` | Failure; already-admitted calls may still settle |
| `TimeoutExceeded` | Interrupt deadline | Failure; dispose context; in-flight handler completions must not resolve into a disposed VM |
| `ExecutionFailure` | Uncaught throw, including unhandled inner-tool rejection | Failure; `message` is the guest error message only |

A failing inner tool **rejects the guest promise**; it does not fail the whole `execute` unless the program lets it propagate. Dispose QuickJS runtime/context/handles on every path, including timeout.

## Testing

No LLM. `node --import tsx --test` against fake `ToolDef`s.

**`packages/runtime/src/codemode/runtime.test.ts`**

- Sequence: second call sees the first result.
- `Promise.all`: two delayed tools finish in less than the sum of their delays.
- 9th concurrent call waits (does not fail); 8 run together.
- 33rd call is `ToolCallLimitExceeded` at the default limit (tests may pass a smaller `maxToolCalls`).
- Tight `while (true) {}` hits `timeoutMs`.
- Oversize `return` is `ok: true` with `truncated: true`.
- Syntax error → `ParseError`; empty code → `ParseError`.
- Unknown tool is catchable; uncaught throw → `ExecutionFailure`.
- Inner handler reject is catchable with `try/catch`.
- Guest `process` / `require` / `fs` are missing.
- Returning a function or a cycle → `InvalidDataValue`.
- Mutating arguments inside the guest does not mutate the host object.
- `console.log` appears in `logs`.
- `undefined` return → `value: null`.

**`packages/runtime/src/tools/registry.test.ts` (extend)**

- `worker` and `orchestrator` include `execute`.
- `planner`, `reviewer`, `communicator`, `librarian` do not.
- Sibling catalog of `execute` includes identity custom tools and never includes `execute`.

## Docs

- `docs/reference/config.md`: document the three `RUNTIME_CODEMODE_*` env vars and defaults.
- `docs/guides/writing-custom-tools.md`: one short note that worker/orchestrator custom tools are callable from `execute` as `await tools.<name>(input)`, and that `execute` is a reserved name.

## Non-goals (v1)

- `$codemode.search` / token-budgeted catalog
- `@opencode-ai/codemode`, Effect, Asyncify, Node `vm`, a host-owned AST interpreter
- Hiding sibling tools or changing `runToolLoop`’s one-call-per-turn default
- `execute` on planner, reviewer, communicator, librarian, or external CLI executors
- SIGKILL of in-flight `run_shell` when the guest times out
- Approval prompts, pause/resume, heuristic `JSON.parse` of tool strings
- Configurable concurrency or WASM memory
- Exporting codemode types from the public runtime API
- `artificer.config.json` knobs (env only)

## Constraints

- No Effect dependency. Runtime stays on the existing `ai` SDK + `zod` stack plus `quickjs-emscripten`.
- Nested `execute` is impossible: it is never a sibling.
- Custom tools named `execute` are skipped when merging the identity registry (built-in wins). Log a warning.
- Inner calls count toward `maxToolCalls` only, not toward `maxIterationsPerCall`.
- The feature ships behind no flag: if the role has `execute`, it is available. Limits are the safety valve.
