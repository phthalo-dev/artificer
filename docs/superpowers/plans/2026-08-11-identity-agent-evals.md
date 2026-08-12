# Identity-Based Agent Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship identity-based agent evals — `agent/evals/` in the identity repo, `@artificer-ai/eval` driver package, `artificer eval` CLI, read-only eval mode in the runtime, and a consumer-facing Benchmark UI empty state — so scaffolded agents can run `artificer eval run` and view results without cloning the Artificer monorepo.

**Architecture:** Extract the existing `packages/runtime/bench/src` driver into a new `packages/eval` package. Identity evals load tasks from `agent/evals/` and spawn **one runtime per suite** with `ARTIFICER_IDENTITY_DIR` set to the agent project and `RUNTIME_EVAL_MODE=true`. Results land in `$ARTIFICER_EXEC_DIR/evals/runs/<run-id>/`; the runtime UI reader switches to that path. Maintainer `pnpm bench` (SWE-bench/DeepSWE) re-exports the same package under a `bench/` entrypoint with bare-runtime defaults.

**Tech Stack:** TypeScript, Node ≥21, existing bench HTTP client/poll/report code, Hono runtime API, React UI.

**Spec:** [Identity-Based Agent Evals design](../specs/2026-08-11-identity-agent-evals-design.md)

## Global Constraints

- **`RUNTIME_EVAL_MODE=true`** during all identity eval runs — no memory writes, no `learn`/`add_memory`, no identity git pull/push/commit, no `persistConfig` / identity file mutation. No opt-out flag in v1.
- **One runtime per suite** — single child process for the full suite; fresh workstream + workspace per task.
- **Results in exec dir** — `$ARTIFICER_EXEC_DIR/evals/`, never committed to the identity repo.
- **Hide-until-grade** — agent never receives `hidden/` contents; graders run on the host after the task completes.
- **Reuse bench artifact shapes** — `attempts.json`, `eval-report.json`, `report.json`, `run-config.json`, `runs/<id>.json` trajectories match existing bench schemas so `report.ts` and the UI need minimal changes.
- **Greenfield fixture content** (Pack A `implement-hello-tool`) uses plain ESM JavaScript + `node:test` only — no npm install at grade time.
- **Phase 1 task kinds:** `message`, `workstream`, `greenfield` only. `repo-patch` is Phase 2.
- **Phase 1 graders:** `message-contains`, `workstream-status`, `shell` only. `file-exists` is Phase 2.
- **Benchmark nav** stays visible; empty state shows `artificer eval run` (not `packages/runtime` copy).
- **Do not break** existing `pnpm bench` SWE-bench/DeepSWE/greenfield maintainer workflows.

## File map (created / moved)

| Path | Responsibility |
|------|----------------|
| `packages/eval/package.json` | `@artificer-ai/eval` publishable package |
| `packages/eval/src/types.ts` | Identity eval types + shared bench types |
| `packages/eval/src/identity/load-suite.ts` | Read `agent/evals/suites/*.json` |
| `packages/eval/src/identity/load-task.ts` | Read `agent/evals/tasks/<id>/` |
| `packages/eval/src/identity/grade.ts` | Run graders (`message-contains`, `workstream-status`, `shell`) |
| `packages/eval/src/driver/runtime.ts` | Spawn one runtime per suite (identity + eval mode) |
| `packages/eval/src/driver/run-task.ts` | Execute one eval task via HTTP API |
| `packages/eval/src/driver/run-suite.ts` | Suite loop, write artifacts, symlink `latest` |
| `packages/eval/src/driver/client.ts` | Moved from `bench/src/client.ts` |
| `packages/eval/src/driver/extract-patch.ts` | Moved from bench |
| `packages/eval/src/driver/report.ts` | Moved from bench |
| `packages/eval/src/bench/*` | Maintainer SWE-bench/DeepSWE (moved from `runtime/bench/src`) |
| `packages/eval/src/index.ts` | `runIdentityEval`, `listEvalSuites` exports |
| `packages/cli/src/commands/eval.ts` | `artificer eval run` / `list` |
| `packages/runtime/src/config.ts` | `evalMode` from `RUNTIME_EVAL_MODE` |
| `packages/runtime/src/server/bench.ts` | Read `$ARTIFICER_EXEC_DIR/evals/latest` |
| `packages/ui/src/pages/BenchPage.tsx` | Consumer empty state |

---

### Task 1: Scaffold `@artificer-ai/eval` package

**Files:**
- Create: `packages/eval/package.json`
- Create: `packages/eval/tsconfig.json`
- Create: `packages/eval/src/index.ts`
- Modify: `pnpm-workspace.yaml` (already covers `packages/*` — no change if pattern matches)
- Modify: root `package.json` publish script if needed

**Interfaces:**
- Produces: empty package wired into workspace; `pnpm --filter @artificer-ai/eval type-check` passes.

- [ ] **Step 1: Create `packages/eval/package.json`**

```json
{
  "name": "@artificer-ai/eval",
  "version": "0.1.0",
  "description": "Artificer identity eval driver and maintainer bench harness",
  "type": "module",
  "engines": { "node": ">=21" },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./bench": "./src/bench/main.ts"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "type-check": "tsc --noEmit",
    "test": "node --import tsx --test \"src/**/*.test.ts\"",
    "lint": "prettier --check \"src/**/*.ts\""
  },
  "dependencies": {
    "@artificer-ai/runtime": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.11.5",
    "tsx": "^4.19.2",
    "typescript": "^5.3.3"
  },
  "publishConfig": {
    "access": "public",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
      ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
      "./bench": { "types": "./dist/bench/main.d.ts", "import": "./dist/bench/main.js" }
    }
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (extend repo root patterns; `outDir: dist`, `rootDir: src`)

- [ ] **Step 3: Create stub `src/index.ts`**

```ts
export const EVAL_PACKAGE = '@artificer-ai/eval';
```

- [ ] **Step 4: Install and type-check**

```bash
pnpm install
pnpm --filter @artificer-ai/eval type-check
```

Expected: PASS (no errors).

---

### Task 2: Identity eval types

**Files:**
- Create: `packages/eval/src/types.ts`
- Create: `packages/eval/src/types.test.ts`

**Interfaces:**
- Produces: `EvalTaskKind`, `EvalTaskManifest`, `EvalSuiteDefinition`, `EvalGrade`, `LoadedEvalTask`, `EvalRunOptions` — consumed by Tasks 3–8.

- [ ] **Step 1: Write failing type guard tests**

```ts
// packages/eval/src/types.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvalTaskManifest, parseEvalSuite } from './types.js';

test('parseEvalTaskManifest accepts message task', () => {
  const m = parseEvalTaskManifest({
    id: 'status-preset-query',
    title: 'Preset query',
    kind: 'message',
    grade: { type: 'message-contains', pattern: 'async-economy' },
  });
  assert.equal(m.kind, 'message');
});

test('parseEvalTaskManifest rejects repo-patch in phase 1', () => {
  assert.throws(() =>
    parseEvalTaskManifest({
      id: 'x',
      title: 'x',
      kind: 'repo-patch',
      grade: { type: 'shell', command: 'true' },
    }),
  );
});

test('parseEvalSuite requires taskIds', () => {
  const s = parseEvalSuite({ name: 'Smoke', taskIds: ['a'] });
  assert.deepEqual(s.taskIds, ['a']);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @artificer-ai/eval test
```

- [ ] **Step 3: Implement `types.ts`**

```ts
export type EvalTaskKind = 'message' | 'workstream' | 'greenfield';

export type EvalGrade =
  | { type: 'message-contains'; pattern: string }
  | { type: 'workstream-status'; expect: string[] }
  | { type: 'shell'; command: string; cwd?: string };

export interface EvalTaskManifest {
  id: string;
  title: string;
  kind: EvalTaskKind;
  timeoutMs?: number;
  maxRuns?: number;
  test_command?: string; // greenfield
  grade: EvalGrade;
}

export interface EvalSuiteDefinition {
  name: string;
  description?: string;
  taskIds: string[];
}

export interface LoadedEvalTask {
  manifest: EvalTaskManifest;
  prompt: string;
  taskDir: string;
  fixtureDir?: string;
  hiddenDir?: string;
}

export interface EvalRunOptions {
  identityDir: string;
  execDir: string;
  suiteId?: string;
  taskId?: string;
  presetId?: string;
  resultsDir?: string;
  liveProgress?: boolean;
}

// parseEvalTaskManifest / parseEvalSuite: validate with throws on unknown kind/grade
```

Phase 1: `parseEvalTaskManifest` throws if `kind === 'repo-patch'`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Export from `src/index.ts`**

---

### Task 3: Load suites and tasks from `agent/evals/`

**Files:**
- Create: `packages/eval/src/identity/paths.ts`
- Create: `packages/eval/src/identity/load-suite.ts`
- Create: `packages/eval/src/identity/load-task.ts`
- Create: `packages/eval/src/identity/load.test.ts`
- Create: `packages/eval/src/identity/fixtures/smoke/` (minimal test fixture tree)

**Interfaces:**
- Consumes: types from Task 2.
- Produces: `resolveEvalsDir(identityDir)`, `loadEvalSuite(identityDir, suiteId)`, `loadEvalTask(identityDir, taskId)`, `listEvalSuites(identityDir)`, `listEvalTasks(identityDir)`.

- [ ] **Step 1: Write loader tests using `src/identity/fixtures/`**

Fixture tree:

```
packages/eval/src/identity/fixtures/agent-project/
  agent/evals/suites/smoke.json
  agent/evals/tasks/hello-message/eval.json
  agent/evals/tasks/hello-message/prompt.md
```

`smoke.json`: `{ "name": "Smoke", "taskIds": ["hello-message"] }`

`hello-message/eval.json`:

```json
{
  "id": "hello-message",
  "title": "Hello",
  "kind": "message",
  "grade": { "type": "message-contains", "pattern": "preset" }
}
```

`prompt.md`: `What model preset am I using?`

- [ ] **Step 2: Implement loaders**

```ts
export function resolveEvalsDir(identityDir: string): string {
  return path.join(identityDir, 'agent', 'evals');
}

export async function loadEvalSuite(
  identityDir: string,
  suiteId: string,
): Promise<EvalSuiteDefinition> {
  const raw = await fs.readFile(
    path.join(resolveEvalsDir(identityDir), 'suites', `${suiteId}.json`),
    'utf8',
  );
  return parseEvalSuite(JSON.parse(raw));
}

export async function loadEvalTask(
  identityDir: string,
  taskId: string,
): Promise<LoadedEvalTask> { /* read eval.json, prompt.md, optional fixture/hidden dirs */ }
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
pnpm --filter @artificer-ai/eval test
```

---

### Task 4: `RUNTIME_EVAL_MODE` config flag

**Files:**
- Modify: `packages/runtime/src/config.ts`
- Create: `packages/runtime/src/config.eval-mode.test.ts`

**Interfaces:**
- Produces: `RuntimeConfig.evalMode: boolean` when `RUNTIME_EVAL_MODE=true`.

- [ ] **Step 1: Write failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

test('loadConfig sets evalMode from RUNTIME_EVAL_MODE', () => {
  const cfg = loadConfig({
    ...minimalEnv,
    RUNTIME_EVAL_MODE: 'true',
  });
  assert.equal(cfg.evalMode, true);
});

test('evalMode defaults false', () => {
  const cfg = loadConfig(minimalEnv);
  assert.equal(cfg.evalMode, false);
});
```

Add `evalMode?: boolean` to `RuntimeConfig` interface (default `false`).

- [ ] **Step 2: Implement in `loadConfig`**

```ts
evalMode: env.RUNTIME_EVAL_MODE === 'true',
```

- [ ] **Step 3: Run runtime tests**

```bash
pnpm --filter @artificer-ai/runtime test
```

---

### Task 5: Eval-mode identity write guards

**Files:**
- Modify: `packages/runtime/src/engine/workstream-memory.ts`
- Modify: `packages/runtime/src/tools/communication.ts` (`learn` handler)
- Modify: `packages/runtime/src/tools/orchestrator-tool.ts` (`add_memory` handler)
- Modify: `packages/runtime/src/storage/identity-git-sync.ts`
- Modify: `packages/runtime/src/engine/engine.ts` (`persistConfig`, `commitIdentityAfterRun`, identity pull scheduling)
- Modify: `packages/runtime/src/index.ts` (skip identity pull interval when evalMode)
- Create: `packages/runtime/src/engine/eval-mode.test.ts`

**Interfaces:**
- Consumes: `RuntimeConfig.evalMode` from Task 4.

- [ ] **Step 1: Write integration tests**

```ts
test('learn tool returns error in eval mode', async () => {
  const engine = await buildTestEngine({ evalMode: true });
  // invoke learn handler → expect message containing "eval mode"
});

test('WorkstreamMemoryService skips distill in eval mode', async () => {
  // terminal workstream → assert identity.listMemories() unchanged
});

test('IdentityGitSync.commitMemories is no-op in eval mode', async () => {
  // add memory directly to store, call commit → no git commit
});
```

- [ ] **Step 2: Add early-return guards**

Pattern (use consistently):

```ts
if (engine.config.evalMode) {
  return 'Error: Identity writes are disabled during eval mode.';
}
```

Apply in:
- `WorkstreamMemoryService.onWorkstreamTerminal` (skip distill)
- `learn` tool handler
- `add_memory` orchestrator tool handler
- `IdentityGitSync.pull`, `.push`, `.commitMemories`, `.maybeAutoCommit`
- `Engine.persistConfig`, `Engine.commitIdentityAfterRun`
- `createRuntime` / `index.ts`: do not start `runIdentityPullCycle` interval when `evalMode`

- [ ] **Step 3: Run tests — expect PASS**

```bash
pnpm --filter @artificer-ai/runtime test
```

---

### Task 6: Migrate shared driver code into `@artificer-ai/eval`

**Files:**
- Move (git mv): `packages/runtime/bench/src/client.ts` → `packages/eval/src/driver/client.ts`
- Move: `events.ts`, `poll.ts`, `poll.test.ts`, `extract-patch.ts`, `extract-patch.test.ts`, `cost.ts`, `report.ts`, `history.ts`, `git-sandbox.ts`
- Create: `packages/eval/src/bench/` — move remaining bench files (`main.ts`, `config.ts`, `run-instance.ts`, `runtime-process.ts`, `suites.ts`, `dataset.ts`, `deepswe.ts`, `greenfield.ts`, `eval-deepswe.ts`, `eval-greenfield.ts`, `external-agent.ts`, `presets.ts`, `types.ts` bench-specific)
- Modify: `packages/runtime/bench/src/main.ts` → one-liner re-export:

```ts
import '@artificer-ai/eval/bench';
```

- Modify: `packages/runtime/package.json` — add `"@artificer-ai/eval": "workspace:*"` devDependency; bench scripts unchanged.

**Interfaces:**
- Produces: `@artificer-ai/eval/bench` entry runs existing `pnpm bench` behavior.

- [ ] **Step 1: Move files; fix imports** (`../../src/engine/presets.js` → `@artificer-ai/runtime` exports)

- [ ] **Step 2: Update `runtime-process.ts` runtime entry resolution**

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const runtimeRoot = path.dirname(
  require.resolve('@artificer-ai/runtime/package.json'),
);
const RUNTIME_ENTRY = path.join(runtimeRoot, 'dist/index.js');
// monorepo dev fallback: if dist missing, use src/index.ts via tsx (keep existing behavior)
```

- [ ] **Step 3: Verify maintainer bench still works**

```bash
cd packages/runtime && pnpm bench --limit 1 --suite tasks/greenfield-mini.json
```

Expected: driver starts (may fail on missing API key — that's OK; verify it launches).

- [ ] **Step 4: Run eval package tests**

```bash
pnpm --filter @artificer-ai/eval test
pnpm --filter @artificer-ai/runtime test
```

---

### Task 7: Eval runtime spawn (one per suite, identity-aware)

**Files:**
- Create: `packages/eval/src/driver/runtime.ts`
- Create: `packages/eval/src/driver/runtime.test.ts`

**Interfaces:**
- Consumes: `RuntimeClient` from `driver/client.ts`; preset helpers from runtime exports.
- Produces: `startEvalRuntime(options: EvalRuntimeOptions): Promise<EvalRuntimeHandle>` with `{ client, execDir, identityDir, stop }`.

- [ ] **Step 1: Write test** (mock spawn or assert env passed to spawn)

Verify spawned env includes:

```
ARTIFICER_IDENTITY_DIR=<identityDir>
ARTIFICER_EXEC_DIR=<execDir>
RUNTIME_EVAL_MODE=true
RUNTIME_CONCURRENCY=1
RUNTIME_RESUME_ON_STARTUP=false
```

- [ ] **Step 2: Implement `startEvalRuntime`**

Based on `bench/src/runtime-process.ts` but:
- Accept `identityDir` explicitly (not temp-only)
- Always set `RUNTIME_EVAL_MODE=true`
- **One handle per suite** — caller calls `stop()` after all tasks

- [ ] **Step 3: Run tests**

---

### Task 8: Message eval task runner + `message-contains` grader

**Files:**
- Create: `packages/eval/src/driver/run-message-task.ts`
- Create: `packages/eval/src/identity/grade.ts`
- Create: `packages/eval/src/identity/grade.test.ts`

**Interfaces:**
- Produces: `runMessageTask(client, task, config): Promise<EvalTaskResult>`

`EvalTaskResult` shape (align with bench `AttemptRecord`):

```ts
export interface EvalTaskResult {
  instanceId: string;
  outcome: 'submitted' | 'timeout' | 'failed' | 'error';
  durationMs: number;
  messageId?: string;
  outboundMessages: string[];
  usage?: UsageSummary;
  resolved?: boolean;
}
```

- [ ] **Step 1: Write grader test**

```ts
test('message-contains passes when pattern matches outbound', () => {
  const ok = gradeMessageContains(['Your preset is async-economy'], 'async-economy');
  assert.equal(ok, true);
});
```

- [ ] **Step 2: Implement message task flow**

1. `POST /api/messages` with `prompt.md` content
2. Poll `/api/state` until queue idle and communicator run done (reuse `poll.ts` patterns; add `waitForInboundComplete` helper)
3. `GET /api/messages` or store-backed fetch for outbound messages — **if no list endpoint exists**, add `GET /api/messages/:id/thread` or record outbounds during poll via `/events` SSE (prefer events capture to avoid new API in v1)
4. Run `message-contains` grader

**Events approach (no new API):** extend `subscribeEvents` collector to gather `message` events with `direction: outbound`.

- [ ] **Step 3: Unit tests with mocked client**

- [ ] **Step 4: Run tests**

---

### Task 9: Workstream eval task runner + `workstream-status` grader

**Files:**
- Create: `packages/eval/src/driver/run-workstream-task.ts`
- Modify: `packages/eval/src/identity/grade.ts`

**Interfaces:**
- Produces: `runWorkstreamTask(client, task, config): Promise<EvalTaskResult>`

- [ ] **Step 1: Implement workstream path** (adapt from `bench/run-instance.ts` without SWE-bench header)

For tasks without `repo` pin:
- `POST /api/workstreams` with `{ title, goal: prompt, autostart: true }`
- Poll until terminal status
- Grade with `workstream-status` (`expect: ['done']` default)

- [ ] **Step 2: Grader test + implementation**

```ts
export function gradeWorkstreamStatus(
  status: string,
  expect: string[],
): boolean {
  return expect.includes(status);
}
```

- [ ] **Step 3: Run tests**

---

### Task 10: Greenfield eval task runner + `shell` grader

**Files:**
- Create: `packages/eval/src/driver/run-greenfield-task.ts`
- Move/adapt: greenfield materialize logic from `bench/greenfield.ts` into `packages/eval/src/identity/greenfield-fixture.ts`
- Adapt: `eval-greenfield.ts` grading into `packages/eval/src/identity/grade-greenfield.ts`

**Interfaces:**
- Produces: `runGreenfieldTask(client, task, config): Promise<EvalTaskResult>` with patch extraction + shell grade.

- [ ] **Step 1: Port `copyDir`, scaffold materialization, hidden overlay** from bench greenfield loader — source paths are `task.fixtureDir` / `task.hiddenDir` under identity evals, not `bench/tasks/greenfield/`.

- [ ] **Step 2: Workstream flow**

1. Materialize `fixture/` into workspace git repo
2. `POST /api/workstreams` with goal = `prompt.md`, `repoUrl` = local file path or pre-cloned dir, `autostart: true`
3. Poll to completion
4. `extractPatch(workspace, baseCommit)` 
5. Overlay `hidden/` onto patched repo
6. Run `test_command` from manifest via `grade.type: 'shell'`

- [ ] **Step 3: Test with `packages/eval/src/identity/fixtures/greenfield-hello-tool/`** (minimal 2-file scaffold + hidden test — copy structure from `greenfield-todo-store` but smaller)

- [ ] **Step 4: Run tests** (unit tests for overlay + grade; optional integration test marked `@integration`)

---

### Task 11: Suite driver, results layout, report

**Files:**
- Create: `packages/eval/src/driver/run-suite.ts`
- Create: `packages/eval/src/driver/results-paths.ts`
- Modify: `packages/eval/src/driver/report.ts` (if needed — accept eval results dir)

**Interfaces:**
- Produces: `runIdentityEval(options: EvalRunOptions): Promise<{ resultsDir: string }>`

- [ ] **Step 1: Implement results paths**

```ts
export function evalResultsRoot(execDir: string): string {
  return path.join(execDir, 'evals');
}

export function newEvalRunDir(execDir: string, suiteId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(evalResultsRoot(execDir), 'runs', `${stamp}-${suiteId}`);
}

export async function updateLatestSymlink(execDir: string, runDir: string): Promise<void> {
  const link = path.join(evalResultsRoot(execDir), 'latest');
  await fs.rm(link, { force: true });
  await fs.symlink(runDir, link, 'dir');
}
```

- [ ] **Step 2: Implement `runIdentityEval`**

1. Resolve `identityDir` (cwd default), `execDir` (`ARTIFICER_EXEC_DIR` or `~/.artificer/<name>/eval-runs`)
2. Load suite (default `smoke`)
3. `startEvalRuntime` once
4. For each taskId: dispatch by `kind` → append to `attempts[]`, write incremental artifacts
5. Build `eval-report.json` from grader results
6. Call `report.ts` merge
7. `stop()` runtime
8. `updateLatestSymlink`
9. Write `run-config.json` including `identityGitSha` (from `git rev-parse HEAD` in identityDir)

- [ ] **Step 3: Export `runIdentityEval` from `src/index.ts`**

- [ ] **Step 4: Manual smoke** (requires LLM key)

```bash
cd <scaffolded-agent-with-evals>
artificer eval run --suite smoke
```

---

### Task 12: `artificer eval` CLI commands

**Files:**
- Create: `packages/cli/src/commands/eval.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json` — add `"@artificer-ai/eval": "workspace:*"`

**Interfaces:**
- Consumes: `runIdentityEval`, `listEvalSuites`, `listEvalTasks` from `@artificer-ai/eval`.

- [ ] **Step 1: Implement `eval run`**

```ts
export async function evalRun(argv: string[]): Promise<void> {
  const suite = flag(argv, 'suite') ?? 'smoke';
  const task = flag(argv, 'task');
  const preset = flag(argv, 'preset');
  const { runIdentityEval } = await import('@artificer-ai/eval');
  const result = await runIdentityEval({
    identityDir: process.cwd(),
    execDir: process.env.ARTIFICER_EXEC_DIR ?? defaultExecDir(process.cwd()),
    suiteId: task ? undefined : suite,
    taskId: task,
    presetId: preset,
  });
  console.log(`Results: ${result.resultsDir}`);
}
```

- [ ] **Step 2: Implement `eval list`**

Print suites and task counts from `listEvalSuites(cwd)`.

- [ ] **Step 3: Wire `packages/cli/src/index.ts`**

```ts
case 'eval': {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'run') { await evalRun(rest); break; }
  if (sub === 'list') { await evalList(rest); break; }
  // print usage
}
```

Update default usage string.

- [ ] **Step 4: Type-check CLI**

```bash
pnpm --filter @artificer-ai/cli type-check
```

---

### Task 13: Runtime bench reader → exec dir evals

**Files:**
- Modify: `packages/runtime/src/server/bench.ts`
- Modify: `packages/runtime/src/config.ts` (expose `execDir` to bench reader if needed)
- Create: `packages/runtime/src/server/bench.eval-path.test.ts`

**Interfaces:**
- `benchResultsDir()` resolution order:
  1. `BENCH_RESULTS_DIR` env (maintainer override)
  2. `$ARTIFICER_EXEC_DIR/evals/latest` if exists
  3. `cwd/bench/results` (legacy monorepo)

- [ ] **Step 1: Write path resolution test**

- [ ] **Step 2: Implement `benchResultsDir()`**

```ts
export function benchResultsDir(): string {
  if (process.env.BENCH_RESULTS_DIR) {
    return path.resolve(process.env.BENCH_RESULTS_DIR);
  }
  const execDir = process.env.ARTIFICER_EXEC_DIR;
  if (execDir) {
    const latest = path.join(path.resolve(execDir), 'evals', 'latest');
    // use latest if symlink/dir exists
  }
  return path.resolve(process.cwd(), 'bench/results');
}
```

- [ ] **Step 3: Implement identity suite catalog**

`readBenchSuites()` reads `agent/evals/suites/*.json` from `config.identityDir` (or `ARTIFICER_IDENTITY_DIR`); returns `runCommand: 'artificer eval run --suite <id>'`.

- [ ] **Step 4: Run runtime tests**

---

### Task 14: Benchmark UI consumer empty state

**Files:**
- Modify: `packages/ui/src/pages/BenchPage.tsx`
- Modify: `packages/ui/src/mocks/handlers.ts` + `mocks/data.ts` (optional mock alignment)

- [ ] **Step 1: Replace empty-state copy**

Remove `packages/runtime` reference. Show:

```
No eval results yet.

Run from your agent project root:
  artificer eval run
  artificer eval run --suite smoke
  artificer eval list
```

- [ ] **Step 2: Render suite catalog from `/api/bench/suites`** when available (list `runCommand` per suite).

- [ ] **Step 3: Build UI**

```bash
pnpm --filter @artificer-ai/ui build
```

- [ ] **Step 4: Manual check** — open Benchmark page on scaffolded agent with no results; verify empty state.

---

### Task 15: Scaffold Pack A evals in `artificer init`

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Create: inline templates or `packages/cli/templates/evals/**` copied at init time

**Pack A tasks to scaffold:**

| Task | Kind | Notes |
|------|------|-------|
| `status-preset-query` | `message` | `prompt.md`: "What model preset is this agent using?" Grade: `message-contains` pattern from preset name in config |
| `implement-hello-tool` | `greenfield` | Bundled `fixture/` + `hidden/` (minimal defineTool scaffold, ESM + node:test) |
| `workstream-smoke` | `workstream` | Simple non-repo goal: "Reply with a workstream summary titled Eval Smoke" — grade `workstream-status: ['done']` (replaces Phase 1 `repo-patch` fix-format task until Phase 2) |

Note: `fix-format-cost-display` (`repo-patch`) moves to **Phase 2** when `repo-patch` kind ships. Pack A stays fully Phase-1-compatible.

- [ ] **Step 1: Add template constants in `init.ts`** (or load from `templates/evals/`)

- [ ] **Step 2: Write files under `agent/evals/` during `init`**

- [ ] **Step 3: Test scaffold**

```bash
cd /tmp && rm -rf eval-test-agent && artificer init eval-test-agent
ls eval-test-agent/agent/evals/suites/smoke.json
ls eval-test-agent/agent/evals/tasks/status-preset-query/prompt.md
```

- [ ] **Step 4: Update `packages/cli/src/commands/init.test.ts`** if present — assert eval files created.

---

### Task 16: Documentation

**Files:**
- Create: `docs/guides/agent-evals.md`
- Modify: `docs/guides/agent-identity-setup.md` (link to evals guide)
- Modify: `packages/runtime/bench/README.md` (clarify maintainer bench vs consumer `artificer eval`)

- [ ] **Step 1: Write `docs/guides/agent-evals.md`** covering:
  - `agent/evals/` layout
  - `artificer eval run` / `list`
  - Graders
  - Viewing results in Benchmark UI
  - `RUNTIME_EVAL_MODE` behavior (read-only identity)
  - Maintainer `pnpm bench` vs consumer evals

- [ ] **Step 2: Link from identity setup guide**

---

### Task 17: CI wiring

**Files:**
- Modify: root `package.json` / turbo (if needed)

- [ ] **Step 1: Ensure CI runs eval package tests**

```bash
pnpm --filter @artificer-ai/eval test
pnpm --filter @artificer-ai/eval type-check
```

- [ ] **Step 2: Full monorepo CI**

```bash
pnpm ci
```

Expected: PASS.

---

## Phase 2 tasks (separate PRs after Phase 1 merges)

### Task 18: `repo-patch` kind + bundled fixture snapshots

- Add `repo-patch` to `EvalTaskKind` (remove phase-1 throw)
- Support `repo.url`, `repo.baseCommit`, optional `fixture/introduce-bug.patch`
- Add `fix-format-cost-display` to Pack A (vendored mini-fixture under task dir)
- Document fixture refresh script in `evals/examples/README.md`

### Task 19: `file-exists` grader + `artificer eval compare`

- `file-exists` checks workspace paths only (`plan.md`, etc.)
- `compare.ts` diff two run dirs → regression JSON + CLI table
- Record compare output optional sidecar `compare.json`

### Task 20: Monorepo `evals/examples/` Pack B

- `evals/examples/runtime-dev/` with pinned Artificer SHAs for maintainer dogfooding
- Not shipped in npm; documented copy path into dev identity

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `@artificer-ai/eval` package | 1, 6 |
| `agent/evals/` convention | 3, 15, 16 |
| `RUNTIME_EVAL_MODE` | 4, 5 |
| One runtime per suite | 7, 11 |
| Task kinds message/workstream/greenfield | 8, 9, 10 |
| Graders message-contains/workstream-status/shell | 8, 9, 10 |
| Results in `$ARTIFICER_EXEC_DIR/evals/` | 11, 13 |
| `artificer eval run/list` | 12 |
| UI empty state | 14 |
| Pack A in init | 15 |
| Bench backward compat | 6 |
| repo-patch / compare / file-exists | Phase 2 (18–19) |
| SWE-bench downloadable pack | Phase 3 (out of scope) |

---

## Manual end-to-end test plan (Phase 1 done)

1. `artificer init my-agent && cd my-agent && npm install`
2. Add `LLM_API_KEY` to `.env`
3. `artificer eval run --suite smoke` — completes, writes `~/.artificer/my-agent/evals/` (or configured exec dir)
4. `artificer dev` — open Benchmark page — see smoke run results
5. Edit `agent/instructions.md` — re-run eval — new run dir created, `latest` updated
6. `pnpm bench --limit 1` from `packages/runtime` — maintainer bench still works
7. Verify `git status` in identity repo is **clean** after eval (no memory/config commits)
