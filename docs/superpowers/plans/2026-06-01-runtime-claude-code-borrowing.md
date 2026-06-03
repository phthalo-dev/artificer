# Runtime Context Borrowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Borrow Claude Code context-economics patterns (search tools, tool-result spill, between-call microcompact, file-read cache, shell policy, cache telemetry, summary fork) while keeping Artificer's hierarchical roles and async scheduler.

**Architecture:** Phase A adds **within-call** budgets (spill + `read_tool_result`) and **between-call** enrichments (`buildContext` digest + file cache). Phase B adds **shell policy** first, then **cache-stable fork** summarization and cache telemetry. No monolithic `query()` loop.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node 20+, `rg` on PATH, Hono, AI SDK `generateText`, `node:test`, bench harness (`packages/runtime/bench`).

**Reference spec:** [docs/superpowers/specs/2026-06-01-runtime-claude-code-borrowing-design.md](../specs/2026-06-01-runtime-claude-code-borrowing-design.md)

**Resolved decisions:** Reviewer gets grep/glob; `read_tool_result` (not `read_file` for spills); Phase B = B2 shell policy before B1 summary fork.

---

## File structure (all phases)

**Phase A — create**
- `packages/runtime/src/tools/search.ts` — `grep`, `glob` tools
- `packages/runtime/src/tools/search.test.ts` — path guard + arg parsing
- `packages/runtime/src/storage/tool-results.ts` — spill, read, aggregate budget
- `packages/runtime/src/storage/tool-results.test.ts`
- `packages/runtime/src/tools/tool-result-read.ts` — `read_tool_result` tool
- `packages/runtime/src/engine/context-compact.ts` — microcompact digest
- `packages/runtime/src/engine/context-compact.test.ts`
- `packages/runtime/src/engine/file-cache.ts` — per-workstream LRU
- `packages/runtime/src/engine/file-cache.test.ts`

**Phase A — modify**
- `packages/runtime/src/config.ts` — new env fields
- `packages/runtime/src/storage/layout.ts` — `toolResultsDir`, `workstreamFileCacheFile`
- `packages/runtime/src/llm/loop.ts` — spill wrapper on tool execute
- `packages/runtime/src/llm/types.ts` — `RunToolLoopOptions` spill context
- `packages/runtime/src/engine/call.ts` — microcompact + file cache in `buildContext`; file-cache hook after `read_file`
- `packages/runtime/src/tools/files.ts` — record read in file cache (via callback or shared helper)
- `packages/runtime/src/tools/registry.ts` — wire search + read_tool_result per role matrix
- `packages/runtime/src/engine/roles.ts` — prompt: prefer grep tool, forbid bash grep/rg on worker
- `packages/runtime/.env.example`
- `packages/runtime/bench/README.md` — `rg` prerequisite, new env vars

**Phase B — create**
- `packages/runtime/src/tools/shell-policy.ts` + `.test.ts`
- `packages/runtime/src/engine/cache-telemetry.ts` + `.test.ts`
- `packages/runtime/src/engine/fork.ts` — workstream summary fork helper

**Phase B — modify**
- `packages/runtime/src/tools/shell.ts` — call shell policy before exec
- `packages/runtime/src/storage/types.ts` — optional `promptCacheKey`, `cacheTelemetry` on `RunRecord`
- `packages/runtime/src/engine/call.ts` — record cache telemetry after loop
- `packages/runtime/src/engine/engine.ts` or `orchestrator-tool.ts` — trigger summary fork after worker
- `packages/runtime/bench/src/runtime-process.ts` — `RUNTIME_SHELL_POLICY=bench`
- `packages/runtime/bench/src/run-instance.ts` or report — cache hit column (if easy)

**Phase C:** deferred (see spec); no tasks in this plan.

---

## Phase A — Cost and exploration

### Task 1: Config and layout foundations

**Files:** `src/config.ts`, `src/storage/layout.ts`, `.env.example`

- [ ] **Step 1:** Extend `RuntimeConfig` with:

```ts
export interface ToolResultConfig {
  maxCharsPerInvocation: number;
  maxCharsPerRun: number;
}
export interface ContextBorrowingConfig {
  microcompactEnabled: boolean;
  fileCacheMaxEntries: number;
  requireRipgrep: boolean;
  toolResults: ToolResultConfig;
}
// Add to RuntimeConfig:
contextBorrowing: ContextBorrowingConfig;
```

Env defaults (document in `.env.example`):
- `RUNTIME_TOOL_RESULT_MAX_CHARS=12000`
- `RUNTIME_TOOL_RESULT_MAX_PER_RUN_CHARS=80000`
- `RUNTIME_MICROCOMPACT_ENABLED=true`
- `RUNTIME_FILE_CACHE_MAX_ENTRIES=64`
- `RUNTIME_REQUIRE_RG=true`

- [ ] **Step 2:** Add to `Layout`:

```ts
toolResultsDir(runId: string): string {
  return path.join(this.root, 'tool-results', runId);
}
workstreamFileCacheFile(workstreamId: string): string {
  return path.join(this.workstreamDir(workstreamId), 'file-cache.json');
}
```

- [ ] **Step 3:** `pnpm --filter @artificer/runtime type-check` passes.

- [ ] **Step 4: Commit** (if user requested commits per task; otherwise skip until PR).

```bash
git add packages/runtime/src/config.ts packages/runtime/src/storage/layout.ts packages/runtime/.env.example
git commit -m "feat(runtime): config and layout for context borrowing"
```

---

### Task 2: Grep and Glob tools

**Files:** `src/tools/search.ts`, `src/tools/search.test.ts`, `src/tools/files.ts` (reuse `resolveScoped`)

- [ ] **Step 1: Failing tests** — path escape rejected; pattern required:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScoped } from './files.js';
// Test resolveScoped rejects ../escape (may already exist — add search-specific tests)
import { buildRipgrepArgs, type GrepInput } from './search.js';

test('buildRipgrepArgs includes pattern and workspace root', () => {
  const args = buildRipgrepArgs({ pattern: 'foo', path: 'src', glob: '*.ts', head_limit: 10 }, '/ws');
  assert.ok(args.includes('foo'));
  assert.ok(args.includes('/ws/src') || args.includes('src'));
});
```

- [ ] **Step 2: Implement `search.ts`**
  - `grep` tool: inputs `pattern`, optional `path` (default `.`), `glob`, `head_limit` (default 50), `-i` flag.
  - Resolve search path with `resolveScoped(workspaceDir, path)`.
  - Spawn `rg --json` or `rg -n` with `cwd` = workspace; cap lines in output.
  - On missing `rg` when `config.contextBorrowing.requireRipgrep`: return `Error: ripgrep (rg) not found on PATH. Install ripgrep…`
  - `glob` tool: `pattern`, optional `cwd`; use `rg --files -g` or fast `fs` walk with micromatch — prefer `rg --files` for consistency.
  - Export `createSearchTools(ctx: ToolContext): ToolDef[]`.

- [ ] **Step 3: Unit test** path traversal: `grep` with `path: '../../etc'` throws or returns error string.

- [ ] **Step 4: Run tests** — `pnpm --filter @artificer/runtime test`

- [ ] **Step 5: Commit** `feat(runtime): add grep and glob tools`

---

### Task 3: Tool result spill (storage layer)

**Files:** `src/storage/tool-results.ts`, `src/storage/tool-results.test.ts`

- [ ] **Step 1: Failing tests**

```ts
test('spill writes file and returns preview with path', async () => {
  const dir = await fs.mkdtemp(...);
  const layout = new Layout(dir);
  const { output, spillPath } = await spillToolResult({
    layout, runId: 'run_1', index: 0, toolName: 'run_shell', body: 'x'.repeat(20_000),
    maxChars: 1000,
  });
  assert.ok(output.includes('[spilled'));
  assert.ok(output.includes('read_tool_result'));
  assert.ok(spillPath);
  const full = await fs.readFile(spillPath, 'utf8');
  assert.equal(full.length, 20_000);
});
```

- [ ] **Step 2: Implement**
  - `spillToolResult({ layout, runId, index, toolName, body, maxChars })` → writes `tool-results/<runId>/<index>-<toolName>.txt`, returns truncated preview + hint to use `read_tool_result` with `spill_id` or relative key.
  - `readSpilledResult(layout, runId, spillKey)` — validate path stays under `toolResultsDir(runId)`.
  - `applyResultBudget({ output, runTotalChars, maxPerInvocation, maxPerRun, ... })` — spill or hard-truncate; update running total.

- [ ] **Step 3: Tests for aggregate cap** — second spill when per-run budget exceeded.

- [ ] **Step 4: Commit** `feat(runtime): tool result spill storage`

---

### Task 4: `read_tool_result` tool

**Files:** `src/tools/tool-result-read.ts`

- [ ] **Step 1:** Tool `read_tool_result` with input `{ run_id?: string, spill_key: string, offset?: number, limit?: number }`.
  - Default `run_id` to `ctx.run.id` if omitted.
  - Only read paths under `layout.toolResultsDir(run_id)` — reject `..` and absolute paths outside dir.
  - Return slice of file with line numbers optional.

- [ ] **Step 2:** Export `createToolResultReadTools(ctx)`.

- [ ] **Step 3: Commit** `feat(runtime): read_tool_result tool`

---

### Task 5: Wire spill into `runToolLoop`

**Files:** `src/llm/loop.ts`, `src/llm/types.ts`, `src/engine/call.ts`

- [ ] **Step 1:** Extend `RunToolLoopOptions`:

```ts
export interface ToolResultSpillContext {
  layout: Layout;
  runId: string;
  config: ToolResultConfig;
  onSpill?: (info: { tool: string; path: string; previewChars: number }) => void;
  getRunCharTotal: () => number;
  addRunChars: (n: number) => void;
}
// Optional on RunToolLoopOptions:
toolResultSpill?: ToolResultSpillContext;
```

- [ ] **Step 2:** In tool `execute`, after `def.handler`:
  - Compute `output` string length.
  - Call `applyResultBudget`; replace return value with preview if spilled.
  - Invoke `onSpill` when spill occurs (call.ts forwards to `engine.emit`).

- [ ] **Step 3:** In `executeCall`, pass spill context with mutable `runCharTotal` (sum invocation output lengths this run).

- [ ] **Step 4:** Extend `RuntimeEvent` in `context.ts` optional kind or use existing `tool` event with `spillPath` in data — spec allows `tool_result_spilled`.

- [ ] **Step 5: Integration test** — mock handler returning 50k chars; assert run record invocation output is short and file exists.

- [ ] **Step 6: Commit** `feat(runtime): spill large tool results in tool loop`

---

### Task 6: Microcompact between calls

**Files:** `src/engine/context-compact.ts`, `src/engine/context-compact.test.ts`, `src/engine/call.ts`

- [ ] **Step 1: Constants**

```ts
export const CLEARED_TOOL_OUTPUT = '[Old tool result content cleared]';
export const COMPACTABLE_TOOLS = new Set([
  'read_file', 'run_shell', 'grep', 'glob', 'fetch_url',
]);
```

- [ ] **Step 2: `buildPriorRunsDigest(store, workstreamId, excludeRunId, maxRuns)`**
  - Load last K completed runs for workstream (e.g. 8), oldest-first in digest.
  - For each tool invocation: if compactable, format `tool(args) @ time → CLEARED` or `→ <path>` if output mentions spill path; else clip output to 400 chars.
  - If `microcompactEnabled` false, only include last 2 runs with full clipped outputs.

- [ ] **Step 3: Tests** — bulky grep output becomes cleared; `submit_review` output preserved.

- [ ] **Step 4:** Append digest section in `buildContext` when `run.workstreamId` set.

- [ ] **Step 5: Commit** `feat(runtime): microcompact prior run digest in context`

---

### Task 7: Workstream file cache

**Files:** `src/engine/file-cache.ts`, `src/engine/file-cache.test.ts`, `src/tools/files.ts`, `src/engine/call.ts`

- [ ] **Step 1: Types**

```ts
export interface FileCacheEntry {
  path: string;
  mtimeMs: number;
  lineRange?: { start: number; end: number };
  snippet?: string;
}
```

- [ ] **Step 2: `FileCache` class** — load/save JSON at `workstreamFileCacheFile`; `recordRead(path, mtime, content?)` with LRU eviction; `formatHintBlock()` → multi-line "Recently read: …".

- [ ] **Step 3: After successful `read_file`** in `files.ts`, if `ctx.run.workstreamId`, update cache (store first 120 chars as snippet, file line count if cheap).

- [ ] **Step 4: Inject** `formatHintBlock()` in `buildContext` for WORK_ROLES.

- [ ] **Step 5: Tests** — LRU evicts oldest when over max entries.

- [ ] **Step 6: Commit** `feat(runtime): per-workstream file read cache`

---

### Task 8: Registry, roles, bench docs

**Files:** `registry.ts`, `roles.ts`, `bench/README.md`

- [ ] **Step 1: `registry.ts`** per spec matrix:
  - `planner`, `worker`, `reviewer`: `createSearchTools` + `createToolResultReadTools` + existing
  - `orchestrator`: optional `grep` only (no glob) + read/list
  - `communicator`, `librarian`: unchanged

- [ ] **Step 2: `roles.ts` prompts**
  - Worker/planner: "Use the `grep` tool for search. Do not run grep/rg via `run_shell`."
  - Reviewer: "Use `grep`/`glob` to verify changes quickly."

- [ ] **Step 3: `bench/README.md`** — Prerequisites: install ripgrep (`brew install ripgrep` / `apt install ripgrep`). Document new `RUNTIME_*` env vars.

- [ ] **Step 4: Manual smoke** — start runtime, spawn workstream, confirm `grep` in tool list for worker via logs or GET state.

- [ ] **Step 5: Commit** `feat(runtime): wire search tools and document bench prereqs`

---

### Task 9: Phase A bench validation

- [ ] **Step 1:** Capture baseline mini-suite metrics (if `bench/results` exists, note in PR; else run once):

```bash
cd packages/runtime/bench && pnpm bench --suite mini --preset bench-budget
```

- [ ] **Step 2:** Run again after Phase A; compare `attempts.json` median `inputTokens`, tool name counts (`grep` vs `run_shell` vs `read_file`), resolve rate.

- [ ] **Step 3:** Record results in PR description (target: similar resolve rate, lower tokens or fewer exploration steps).

- [ ] **Step 4: Commit** `chore(bench): phase A context borrowing baseline notes` (optional `report.md` snippet only if user wants)

**Phase A PR complete** — merge before starting Phase B.

---

## Phase B — Cheap side intelligence

**Order:** B2 → B3 → B1 (shell policy before summary fork).

### Task 10: Shell policy layer (B2)

**Files:** `src/tools/shell-policy.ts`, `src/tools/shell-policy.test.ts`, `src/tools/shell.ts`, `src/config.ts`

- [ ] **Step 1: Tests** — classify samples:

| Command | bench mode |
|---------|------------|
| `git diff` | allow |
| `pytest -x` | allow |
| `rm -rf .` | deny |
| `curl https://x` | deny |
| `cat README.md` | allow |

- [ ] **Step 2: Implement `classifyShellCommand(cmd: string): ShellClass`** and `checkShellPolicy(cmd, mode): { allowed: boolean; reason?: string }`.

- [ ] **Step 3:** Add `shellPolicy: 'permissive' | 'bench' | 'strict'` to config from `RUNTIME_SHELL_POLICY` (default `permissive`).

- [ ] **Step 4:** At start of `run_shell` handler, if denied return `Error: Shell command blocked (bench policy): …`.

- [ ] **Step 5: Commit** `feat(runtime): shell policy for bench and strict modes`

---

### Task 11: Bench driver shell policy (B2 wiring)

**Files:** `bench/src/runtime-process.ts`, `bench/README.md`

- [ ] **Step 1:** In `startRuntime` env block add `RUNTIME_SHELL_POLICY: 'bench'`.

- [ ] **Step 2:** Document that local dev keeps `permissive` unless testing policy.

- [ ] **Step 3: Commit** `chore(bench): enable shell policy in benchmark runs`

---

### Task 12: Prompt cache telemetry (B3)

**Files:** `src/engine/cache-telemetry.ts`, `src/storage/types.ts`, `src/engine/call.ts`, bench report optional

- [ ] **Step 1:** `computePromptCacheKey({ system, toolNames, modelId }): string` — stable SHA-256 hex.

- [ ] **Step 2:** After `runToolLoop`, set on run record:

```ts
run.cacheTelemetry = {
  promptCacheKey,
  cacheReadInputTokens: usage.cacheReadInputTokens,
  cacheCreationInputTokens: usage.cacheCreationInputTokens,
};
```

- [ ] **Step 3:** Optional: if prior run same role+workstream exists with same key but cache read dropped >50%, `console.warn` or store `cacheWarning` on run.

- [ ] **Step 4: Unit test** — same inputs → same key; tool order change → different key.

- [ ] **Step 5:** Extend bench `attempts.json` writer to include `cacheReadInputTokens` / `promptCacheKey` if not already present.

- [ ] **Step 6: Commit** `feat(runtime): prompt cache telemetry on runs`

---

### Task 13: Workstream summary fork (B1)

**Files:** `src/engine/fork.ts`, `src/engine/engine.ts` or `orchestrator-tool.ts`, `src/config.ts`

- [ ] **Step 1:** Config `workstreamSummaryFork: boolean` from `RUNTIME_WORKSTREAM_SUMMARY_FORK` (default false until stable).

- [ ] **Step 2:** `maybeScheduleSummaryFork(engine, completedRun)` in `afterRun` when:
  - `completedRun.role === 'worker'` and status `done`
  - `workstreamSummaryFork` enabled
  - workstream has file changes (`git status` non-empty) OR every 2nd worker run
  - spawn `invoke_call` with role `reviewer` or new internal prompt variant:
    - task: "Summarize workstream progress in 8-12 sentences. Output plain text only."
    - `complexity: 'low'`
    - tools: read-only (`read_file`, `list_files`, `grep`, `get_status`) — no edit
  - On completion: orchestrator or fork writes `workstream.summary` via store API

- [ ] **Step 3:** Freeze tool name list ordering in `computePromptCacheKey` — document that summary fork should reuse same role's tool set as orchestrator where possible for cache hits (best-effort).

- [ ] **Step 4: Manual test** — short workstream; verify summary field updates.

- [ ] **Step 5: Commit** `feat(runtime): optional low-tier workstream summary fork`

---

### Task 14: Phase B bench validation

- [ ] **Step 1:** Run mini-suite with `RUNTIME_SHELL_POLICY=bench` (via driver) + summary fork on/off comparison.

- [ ] **Step 2:** Confirm no `rm`/`curl` in successful worker tool traces; cache read tokens logged.

- [ ] **Step 3:** PR notes for Phase B.

---

## Phase C (deferred)

Do not implement in the first PR series. Track in spec only:

- C1 deferred tool registry (MCP)
- C2 background shell + poll
- C3 hooks
- C4 `.artificer/agents/*.md` overrides

---

## Error handling checklist (implementers)

| Case | Behavior |
|------|----------|
| `rg` missing | Tool error with install hint |
| Spill IO failure | Truncate + `(spill failed)` note |
| `read_tool_result` bad key | Tool error, no path escape |
| Shell denied | Tool error string, run continues |
| Summary fork fails | Log; leave `workstream.summary` unchanged |
| Microcompact disabled | Shorter digest with 2 full runs only |

---

## Testing summary

| Layer | Command |
|-------|---------|
| Unit | `pnpm --filter @artificer/runtime test` |
| Typecheck | `pnpm --filter @artificer/runtime type-check` |
| Bench | `cd packages/runtime/bench && pnpm bench --suite mini --preset bench-budget` |

---

## Suggested PR breakdown

1. **PR1 (Phase A tasks 1–8):** Search, spill, read_tool_result, microcompact, file cache, registry/roles/docs.
2. **PR2 (Phase A task 9):** Bench numbers only (can merge with PR1 if small).
3. **PR3 (Phase B tasks 10–14):** Shell policy + telemetry + summary fork + bench.

This keeps reviewable chunks and allows shipping exploration wins before policy/fork complexity.
