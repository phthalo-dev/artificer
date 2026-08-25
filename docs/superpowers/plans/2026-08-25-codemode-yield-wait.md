# Codemode v2 — Yield / Wait Cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `execute` soft-yield a resumable `cellId`, continue via `wait_execute`, and share run-scoped `store`/`load` KV across cells — without abandoning in-flight guest work at the soft yield boundary.

**Architecture:** `CodemodeCellStore` keeps alive QuickJS runtimes for running cells keyed by `runId`→`cellId`. `runCodemode` splits into start-segment / resume-segment. Guest gains `yield_control`, `store`, `load`, `notify`. Hard `timeoutMs` is cell lifetime from start; soft `yield_time_ms` ends a segment only.

**Tech Stack:** Existing `quickjs-emscripten` sync stack, Node `node:test`.

**Spec:** [docs/superpowers/specs/2026-08-25-codemode-yield-wait-design.md](../specs/2026-08-25-codemode-yield-wait-design.md)

**Depends on:** [Frozen tool plan](./2026-08-25-frozen-tool-plan.md) (cells capture sibling handlers from `ctx.toolPlan`).

## Global Constraints

- Preserve all codemode v1 constraints (no Effect, no nested execute, worker/orchestrator only, JSON-safe boundary, concurrency 8).
- Soft yield must not dispose the isolate; hard timeout disposes.
- `maxToolCalls` counts across the whole cell lifetime.
- `wait_execute` is never a codemode sibling.
- Cells are not persisted across process restarts or across runs.
- Default behavior without pragma / `yield_control` remains v1 one-shot.

## File map

| File | Responsibility |
|---|---|
| `packages/runtime/src/codemode/types.ts` | Extended results, `CellNotFound`, `CellLimitExceeded` |
| `packages/runtime/src/codemode/cells.ts` | Cell store + run KV |
| `packages/runtime/src/codemode/runtime.ts` | Start/resume segments, pragma parse, globals |
| `packages/runtime/src/codemode/bridge.ts` | Install new globals; keep deferreds across yield |
| `packages/runtime/src/tools/execute.ts` | Start cell; extended output |
| `packages/runtime/src/tools/wait-execute.ts` | `wait_execute` tool |
| `packages/runtime/src/tools/registry.ts` / `tool-plan.ts` | Append `wait_execute` |
| `packages/runtime/src/config.ts` | `maxCells`, cell TTL env |
| `packages/runtime/src/engine/call.ts` | Allocate store per run; dispose in `finally` |
| `packages/runtime/src/context.ts` | `codemodeCells?`, ensure `run` available |

---

### Task 1: Config + diagnostic kinds + cell store skeleton

**Files:**
- Modify: `packages/runtime/src/config.ts`, `packages/runtime/src/config.test.ts`
- Modify: `packages/runtime/src/codemode/types.ts`
- Create: `packages/runtime/src/codemode/cells.ts`
- Test: `packages/runtime/src/codemode/cells.test.ts`

**Interfaces:**
```ts
export type DiagnosticKind =
  | 'ParseError' | 'InvalidDataValue' | 'ToolCallLimitExceeded'
  | 'TimeoutExceeded' | 'ExecutionFailure'
  | 'CellNotFound' | 'CellLimitExceeded';

// CodemodeLimits gains:
maxCells: number;       // default 4
cellTtlMs: number;      // default = timeoutMs

export type RunKv = Map<string, unknown>;

export class CodemodeCellStore {
  constructor(opts: { maxCells: number; cellTtlMs: number });
  kv(runId: string): RunKv;
  get(runId: string, cellId: string): CodemodeCell | undefined;
  // create/dispose/list implemented in Task 2 when runtime can fill them
  disposeRun(runId: string): void;
  disposeExpired(now?: number): void;
}
```

- [ ] **Step 1: Failing tests** for defaults `maxCells: 4`, env `RUNTIME_CODEMODE_MAX_CELLS` / `RUNTIME_CODEMODE_CELL_TTL_MS`, `disposeRun` clears KV.

- [ ] **Step 2: Implement parse + skeleton store** (Map of runs → cells/kv; no QuickJS yet).

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): add codemode cell store config and diagnostics

EOF
)"
```

---

### Task 2: Guest globals + start/resume segment API

**Files:**
- Modify: `packages/runtime/src/codemode/runtime.ts`, `bridge.ts`, `types.ts`
- Test: `packages/runtime/src/codemode/runtime.test.ts` (extend)

**Interfaces:**
```ts
export type CodemodeSegmentResult =
  | { ok: true; running: false; value: unknown; logs?: string[]; notifications?: string[]; truncated?: true; toolCalls: string[] }
  | { ok: true; running: true; cellId: string; value?: unknown; logs?: string[]; notifications?: string[]; truncated?: true; toolCalls: string[] }
  | { ok: false; error: { kind: DiagnosticKind; message: string }; cellId?: string; logs?: string[]; notifications?: string[]; truncated?: true; toolCalls: string[] };

export async function startCodemodeCell(opts: {
  code: string;
  tools: CodemodeTool[];
  limits: CodemodeLimits;
  store: CodemodeCellStore;
  runId: string;
  onToolCall?: ToolContext['onToolCall'];
}): Promise<CodemodeSegmentResult>;

export async function resumeCodemodeCell(opts: {
  store: CodemodeCellStore;
  runId: string;
  cellId: string;
  yieldTimeMs?: number;
  terminate?: boolean;
}): Promise<CodemodeSegmentResult>;
```

Keep `runCodemode` as a thin wrapper: `startCodemodeCell` when no yield occurs behaves like v1 (dispose on complete).

- [ ] **Step 1: Failing tests**
  - `yield_control()` → `running: true` with `cellId`
  - resume completes after guest stored a value with `store`/`load`
  - pragma `// @exec: {"yield_time_ms": 50}` yields while a slow tool is in flight; resume finishes
  - hard timeout across segments → `TimeoutExceeded` and cell gone
  - `terminate: true` → complete null; further resume → `CellNotFound`
  - 5th concurrent cell → `CellLimitExceeded`
  - `notify('x')` appears in `notifications` on yield payload
  - existing v1 tests still pass (no pragma → one-shot)

- [ ] **Step 2: Implement**
  - Parse optional first-line pragma before wrap
  - Install globals in bridge
  - On soft yield: pause segment loop, leave runtime in store, return running payload
  - On resume: continue `executePendingJobs` / guest jobs until next yield/complete/timeout
  - Track `toolCalls` / logs / notifications on the cell object

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): codemode yield/wait cells with run-scoped KV

EOF
)"
```

---

### Task 3: `wait_execute` tool + registry + call-path dispose

**Files:**
- Create: `packages/runtime/src/tools/wait-execute.ts`
- Modify: `packages/runtime/src/tools/execute.ts`, `registry.ts`, `engine/call.ts`, `context.ts`
- Test: `packages/runtime/src/tools/registry.test.ts`

**Interfaces:**
```ts
export function createWaitExecuteTool(ctx: ToolContext): ToolDef;
// name: wait_execute
// input: { cellId: string; yield_time_ms?: number; terminate?: boolean }
```

- [ ] **Step 1: Failing registry tests** — worker/orchestrator include `wait_execute`; others do not; execute siblings exclude `wait_execute`.

- [ ] **Step 2: Implement tools** — `execute` uses `startCodemodeCell` with `ctx.codemodeCells` + `ctx.run.id`; `wait_execute` calls `resumeCodemodeCell`.

- [ ] **Step 3: `executeCall`** — create `CodemodeCellStore` from `config.codemode`, set on `ctx`, `disposeRun(run.id)` in `finally`.

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): add wait_execute and per-run cell lifecycle

EOF
)"
```

---

### Task 4: Docs + prompt hint

**Files:**
- Modify: `docs/reference/config.md`
- Modify: `docs/guides/writing-custom-tools.md` (or codemode note)
- Modify: `packages/runtime/src/engine/roles.ts` — one sentence: long batches may yield and `wait_execute`

- [ ] **Step 1: Document** `RUNTIME_CODEMODE_MAX_CELLS`, `RUNTIME_CODEMODE_CELL_TTL_MS`, yield/wait usage.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: document codemode yield/wait cells

EOF
)"
```

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Cell store + run KV | 1–2 |
| `yield_control` / pragma / hard timeout | 2 |
| `store`/`load`/`notify` | 2 |
| `wait_execute` | 3 |
| maxCells / TTL | 1–2 |
| Run-end dispose | 3 |
| Docs | 4 |
