# Codemode v2 — Yield / Wait Cells + Session KV — Design

**Date:** 2026-08-25
**Status:** Approved for planning
**Component:** `packages/runtime` (`codemode/`, `tools/execute.ts`)
**Related:**
- [Codemode v1 design](./2026-08-17-codemode-batched-tool-orchestration-design.md) (shipped)
- [Artificer vs. Codex comparison](../../research/2026-08-24-codex-comparison.md) (Tier 1 borrow #1)

## Purpose

Extend the shipped `execute` tool so a long-running guest program can **yield mid-script**, return a resumable `cellId` to the model, and continue via a `wait_execute` tool — without abandoning in-flight work when `timeoutMs` would otherwise kill the whole program. Add a small **session KV** (`store` / `load`) so successive `execute` cells in the same run can share JSON-safe state.

This does not adopt Codex’s V8 out-of-process host, `CodeModeOnly` tool hiding, or interactive PTY semantics.

## Problem

v1 `execute` is one-shot: the QuickJS context is disposed when the async IIFE settles or when `timeoutMs` fires (`TimeoutExceeded`). Multi-file exploration that legitimately needs more wall time than the budget (or that wants to stream a partial result back to the model before finishing) cannot resume — the model must start a new program and re-do work.

Codex solves this with `yield_control` / `yield_time_ms` → `cell_id` → `wait`. Artificer already chose the same genus (JS orchestrates tools); this is the missing long-running piece.

## Decisions already locked (from v1 — preserved)

- Opt-in `execute` **beside** the existing catalog (siblings still listed).
- QuickJS-in-WASM sync build + promise bridge (not Asyncify, not Effect, not Node `vm`).
- Worker and orchestrator only; no nested `execute`.
- Sibling-tool authority; JSON-safe boundary; concurrency 8; env-based limits.

## Decisions for v2

- **True cells within a single `executeCall` (one `RunRecord`).** A yielded cell keeps its QuickJS runtime/context alive in a host-side `CodemodeCellStore` keyed by `cellId` until the cell completes, is terminated, the run ends, or a cell TTL expires.
- **Separate `wait_execute` tool** (not overloading `execute` input). Mirrors Codex’s `exec`/`wait` split and keeps the `execute({ code })` schema stable.
- **`yield_time_ms` as an optional first-line pragma** in `code` (Codex-compatible shape), plus guest `yield_control()`. Hard `timeoutMs` remains a fail-closed ceiling for the *entire* cell lifetime (wall time from first `execute` admit), not reset by each `wait_execute`.
- **Session KV scoped to the run** (`runId`), not the workstream and not the process. Cleared when the run finishes or the engine recovers the run as zombie.
- **`notify(...)`** appends a string to a cell-local `notifications[]` that is included on the next yield/wait/complete payload (not a separate model turn injection mid-await — Artificer has no mid-stream tool-output channel inside `generateText`).

## Architecture

```
model ──execute({ code })──▶ create / start cell
                                │
                ┌───────────────┼────────────────┐
                ▼               ▼                ▼
           completes      yield_control /    hard timeoutMs
                              yield_time_ms
                │               │                │
                ▼               ▼                ▼
         { ok, value }   { running, cellId }  TimeoutExceeded
                                │
model ──wait_execute({ cellId, terminate? })
                                │
                     resume / poll / terminate
```

```
CodemodeCellStore (per Engine, keyed by runId → cellId)
  cell: {
    id, runId, role,
    runtime + QuickJS context (alive while running),
    bridge state (in-flight deferreds),
    startedAt, deadlineAt (= startedAt + timeoutMs),
    yieldDeadlineAt (optional soft yield),
    notifications[], logs[], toolCalls[],
    status: running | completed | failed | terminated
  }
```

`ToolContext` gains optional `codemodeCells?: CodemodeCellStore` and `runId` (already available via run plumbing) so `createExecuteTool` / `createWaitExecuteTool` share the store for that call.

### Soft yield vs hard timeout

| Mechanism | Effect |
|---|---|
| `yield_control()` | Cooperative: pause guest turn, return `running: true` with accumulated `value`/`logs`/`notifications`/`toolCalls`; cell stays alive |
| `// @exec: {"yield_time_ms": N}` | Soft wall clock from *this* execute/wait segment; if still running, same payload as `yield_control` |
| `timeoutMs` (env) | Hard ceiling from cell start; dispose cell; `TimeoutExceeded` |

Default `yield_time_ms` when pragma absent: **none** (v1 behavior — run until complete or hard timeout). Models opt into yielding explicitly via pragma or `yield_control()`.

### Guest globals (additive)

Installed alongside `tools` and `console`:

| Global | Behavior |
|---|---|
| `yield_control()` | Ends the current host segment successfully-as-running; does not dispose the isolate |
| `store(key, value)` | JSON-copy `value` into run-scoped KV; throws `InvalidDataValue` if not JSON-safe |
| `load(key)` | Returns stored value or `undefined` |
| `notify(value)` | Stringify like `console.log`; push onto `notifications` |
| `exit()` | Complete cell successfully with `value: null` (optional sugar; equivalent to returning) |

`store` / `load` are visible to **all** cells in the same run (including later one-shot `execute` calls that never yield).

## Components

| Unit | Path | Responsibility |
|---|---|---|
| Cell store | `packages/runtime/src/codemode/cells.ts` (new) | Create/get/dispose cells; run-scoped KV; TTL / run-end cleanup |
| Runtime | `codemode/runtime.ts` | Support start-segment / resume-segment APIs; honor yield pragma + `yield_control`; do not dispose on soft yield |
| Bridge | `codemode/bridge.ts` | Install new globals; keep deferred tool promises valid across yield |
| Execute tool | `tools/execute.ts` | Start cell; return extended output shapes |
| Wait tool | `tools/wait-execute.ts` (new) | `wait_execute({ cellId, yield_time_ms?, terminate? })` |
| Registry | `tools/registry.ts` | Append `wait_execute` next to `execute` for worker/orchestrator |
| Call path | `engine/call.ts` | Allocate cell store for the run; dispose on run settle / finally |
| Types | `codemode/types.ts` | Extended result + cell types |
| Config | `config.ts` | Optional `RUNTIME_CODEMODE_MAX_CELLS` (default 4), `RUNTIME_CODEMODE_CELL_TTL_MS` (default = `timeoutMs`) |

## Contracts

### `execute` output (extends v1)

```ts
type ExecuteOutput =
  | {
      ok: true;
      running?: false;
      value: unknown;
      logs?: string[];
      notifications?: string[];
      truncated?: true;
      toolCalls: string[];
    }
  | {
      ok: true;
      running: true;
      cellId: string;
      value?: unknown; // partial, if guest called text-equivalent via notify/return buffer
      logs?: string[];
      notifications?: string[];
      truncated?: true;
      toolCalls: string[];
    }
  | {
      ok: false;
      error: { kind: DiagnosticKind; message: string };
      cellId?: string; // present if failure after cell was created
      logs?: string[];
      notifications?: string[];
      truncated?: true;
      toolCalls: string[];
    };
```

No new `DiagnosticKind` values required for yield. Add `CellNotFound` and `CellLimitExceeded` for wait / admit failures.

### `wait_execute` input

```ts
{
  cellId: string;
  yield_time_ms?: number; // soft segment budget; default 10_000 if omitted
  terminate?: boolean;    // dispose without waiting for completion
}
```

### `wait_execute` output

Same union as `execute` (complete / running / failed). `terminate: true` → `{ ok: true, running: false, value: null, toolCalls }` after dispose, or `{ ok: false, error: { kind: 'CellNotFound', ... } }`.

### Pragma

Optional first line of `code`:

```js
// @exec: {"yield_time_ms": 10000}
```

Invalid JSON in pragma → `ParseError` before the program runs. Unknown pragma keys ignored.

### Limits

| Limit | Default | Notes |
|---|---|---|
| `timeoutMs` | unchanged (120s) | Hard lifetime per cell from start |
| `maxToolCalls` | unchanged | Counts across the whole cell lifetime (yields do not reset) |
| `maxOutputBytes` | unchanged | Applied per returned segment |
| `maxCells` | 4 per run | Concurrent alive cells; 5th `execute` that would yield/start → `CellLimitExceeded` |
| Cell TTL | `timeoutMs` | If no `wait_execute` arrives before TTL, dispose and treat next wait as `CellNotFound` |

## Observability

- Activity feed: outer `execute` / `wait_execute` invocations via existing `runToolLoop` recording; inner tool calls continue through `onToolCall`.
- Emit `RuntimeEvent` `{ kind: 'tool', ... }` as today; optional `meta.cellId` on those events when present (non-breaking additive field if the event type allows — otherwise leave in tool result only for v2).

## Error handling

| Kind | When |
|---|---|
| `CellNotFound` | Unknown / disposed / other-run `cellId` |
| `CellLimitExceeded` | Too many alive cells for this run |
| Existing kinds | Unchanged; hard timeout disposes the cell |

Waiting on a completed cell returns the final completion payload once (idempotent), then further waits are `CellNotFound` after dispose-on-read of terminal state **or** keep terminal payload cached until run end — **prefer keep until run end** so a model that double-waits still sees the result.

## Testing

No LLM. Extend `codemode/runtime.test.ts` + new `codemode/cells.test.ts` + registry tests.

- Guest `yield_control()` → `running: true` with `cellId`; `wait_execute` resumes and sees prior `store`d state.
- Pragma soft yield while `Promise.all` still in flight; wait completes the batch.
- Hard `timeoutMs` across execute+wait disposes and fails.
- `maxToolCalls` shared across segments.
- `terminate: true` prevents further progress.
- `maxCells` enforcement.
- Run-end dispose leaves no live QuickJS runtimes (assert via store size / dispose spies).
- `notify` appears on next segment payload.
- KV isolated per `runId`.

## Docs

- Update `docs/reference/config.md` for new env knobs.
- Short note in any codemode guide: prefer `yield_time_ms` / `yield_control` for long batches; use `wait_execute` to resume.

## Non-goals

- `CodeModeOnly` (hide sibling tools)
- Out-of-process V8 host / gRPC
- Persisting cells across process restarts or across runs
- Workstream-scoped KV
- SIGKILL of in-flight `run_shell` on soft yield (shell keeps running; result still resolves into the cell)
- Streaming token/tool events into the SSE feed beyond existing `onToolCall`
- Changing default `timeoutMs`

## Constraints

- Soft yield must not deadlock the promise bridge: in-flight host tool handlers may continue while the model is between `execute` and `wait_execute`; on resume, `executePendingJobs` must drain as today.
- Cells are never shared across concurrent runs.
- `wait_execute` is not a sibling of `execute` inside the guest (not installed on `tools`).
- External `WorkerExecutor` paths remain unchanged (no `execute` / `wait_execute`).
