# Bench Greenfield Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third bench suite kind, `greenfield`, that measures Artificer's ability to sustain a long-horizon *build-from-scratch* loop (many files, many plan→implement→review cycles) rather than a single-file bug-fix patch — the exact capability Ralph Wiggum-style loops are documented to excel at (Huntley's overnight multi-repo runs) but that the existing SWE-bench and DeepSWE suites don't exercise, since both are single-repo bug-fix patches graded against an existing test suite.

**Architecture:** Reuse the existing bench driver end-to-end (`bench/src/main.ts`, `run-instance.ts`, `report.ts` are all suite-kind-agnostic already — confirmed only one branch point, `run-instance.ts`'s `buildTaskMessage`, checks `instance.suite`). Model greenfield tasks the same way SWE-bench hides its grading tests: a task ships a *scaffold* (stub source files the agent must implement) as the cloned repo, plus a *hidden* directory of acceptance tests that is never shown to the agent and is only overlaid onto its patch at grading time — mirroring how SWE-bench applies its `test_patch` after the agent's patch. No Docker: fixtures are plain, dependency-free ESM JavaScript graded with Node's built-in test runner (`node --test`), so grading is fast, offline, and doesn't need a per-instance image.

**Tech Stack:** TypeScript (bench driver code), plain ESM JavaScript + `node:test`/`node:assert` (fixture content, deliberately dependency-free — see Global Constraints).

## Global Constraints

- Fixture scaffolds and hidden tests use **plain ESM JavaScript only** (`.js`, `"type": "module"`), never TypeScript — this avoids needing a compile step or a pinned Node version for `--experimental-strip-types` during grading. Every existing repo convention (TS) is for the *driver*, not the *fixture content*.
- Grading tests use only Node built-ins (`node:test`, `node:assert/strict`, `node:fs/promises`, `node:path`, `node:os`) — no npm dependencies, so `npm install` is never required during eval and eval has no network dependency.
- Do not modify `bench/src/report.ts` — verified it has no suite-kind-specific logic (`grep -n "suite\|kind" report.ts` returns nothing); it already works generically off `attempts.json` + `eval-report.json`.
- The eval report schema for greenfield must match the existing shape (`resolved_ids`, `unresolved_ids`, `empty_patch_ids`, `error_ids`, `completed_ids`, `schema_version`) exactly, copied from `bench/src/eval-deepswe.ts`, so `report.ts` needs no changes.
- This plan ships exactly one fixture task (`greenfield-todo-store`) to prove the mechanism end-to-end. Additional fixtures follow the same four-file template (Task 4) and are out of scope here — call this out explicitly in `bench/README.md` (Task 7), not as a TODO in code.

---

### Task 1: Extend shared bench types for the greenfield suite kind

**Files:**
- Modify: `packages/runtime/bench/src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SuiteKind` including `'greenfield'` and `BenchInstance.test_command`, consumed by Tasks 2, 3, and 6.

- [ ] **Step 1: Add `'greenfield'` to `SuiteKind` and a `test_command` field to `BenchInstance`**

In `packages/runtime/bench/src/types.ts`, change:

```ts
export type SuiteKind = 'swebench' | 'deepswe';
```

to:

```ts
export type SuiteKind = 'swebench' | 'deepswe' | 'greenfield';
```

And add a field to `BenchInstance` (after the existing `docker_image?` field):

```ts
  /** DeepSWE: prebuilt verifier image. */
  docker_image?: string;
  /** Greenfield: shell command to run the hidden acceptance tests, relative to repo root. */
  test_command?: string;
  display_title?: string;
```

(`display_title` already exists directly below `docker_image` — insert `test_command` between them, don't duplicate `display_title`.)

- [ ] **Step 2: Type-check**

```bash
cd packages/runtime && pnpm exec tsc --noEmit -p .
```

Expected: no new errors (the field is optional, so nothing else breaks).

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/bench/src/types.ts
git commit -m "bench: add greenfield suite kind to shared types"
```

---

### Task 2: Greenfield fixture loader

**Files:**
- Create: `packages/runtime/bench/src/greenfield.ts`
- Modify: `packages/runtime/bench/src/suites.ts`

**Interfaces:**
- Consumes: `BenchInstance`, `SuiteKind` from Task 1; `TASKS_DIR`, `CACHE_DIR` from `packages/runtime/bench/src/config.ts` (existing).
- Produces: `loadGreenfieldInstances(taskIds: string[]): Promise<BenchInstance[]>`, consumed by `suites.ts`'s `loadSuiteInstances` (this task) and exercised end-to-end in Task 4/5's manual run.

- [ ] **Step 1: Write the loader**

Create `packages/runtime/bench/src/greenfield.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TASKS_DIR, CACHE_DIR } from './config.js';
import type { BenchInstance } from './types.js';

const execFileAsync = promisify(execFile);

/** Fixture tasks live under bench/tasks/greenfield/<task-id>/. */
export const GREENFIELD_FIXTURES_DIR = path.join(TASKS_DIR, 'greenfield');

interface GreenfieldMeta {
  task_id: string;
  display_title?: string;
  test_command: string;
}

/** Recursively copies a directory tree (used for both scaffold and hidden overlays). */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

/**
 * Materializes a fixture's scaffold/ directory into a fresh local git repo the
 * bench driver can `git clone` like any other instance, and commits it so
 * there is a base_commit to check out. Re-materializes on every call so a
 * fixture edit is always picked up (cheap: fixtures are a handful of files).
 */
async function materializeScaffold(
  taskId: string,
): Promise<{ repoDir: string; commit: string }> {
  const fixtureDir = path.join(GREENFIELD_FIXTURES_DIR, taskId);
  const repoDir = path.join(CACHE_DIR, 'greenfield', taskId, 'repo');
  await fs.rm(repoDir, { recursive: true, force: true });
  await copyDir(path.join(fixtureDir, 'scaffold'), repoDir);

  const git = (args: string[]) => execFileAsync('git', args, { cwd: repoDir });
  await git(['init', '-q']);
  await git(['config', 'user.email', 'bench@artificer.local']);
  await git(['config', 'user.name', 'artificer-bench']);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'scaffold']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  return { repoDir, commit: stdout.trim() };
}

/** Loads one greenfield fixture into the shared BenchInstance shape. */
export async function loadGreenfieldTask(taskId: string): Promise<BenchInstance> {
  const fixtureDir = path.join(GREENFIELD_FIXTURES_DIR, taskId);
  const [metaRaw, spec] = await Promise.all([
    fs.readFile(path.join(fixtureDir, 'meta.json'), 'utf8'),
    fs.readFile(path.join(fixtureDir, 'spec.md'), 'utf8'),
  ]);
  const meta = JSON.parse(metaRaw) as GreenfieldMeta;
  const { repoDir, commit } = await materializeScaffold(taskId);

  return {
    instance_id: meta.task_id,
    repo: meta.task_id,
    base_commit: commit,
    problem_statement: spec.trim(),
    suite: 'greenfield',
    repository_url: repoDir,
    display_title: meta.display_title,
    test_command: meta.test_command,
  };
}

/** Loads a curated list of greenfield fixtures, preserving request order. */
export async function loadGreenfieldInstances(
  taskIds: string[],
): Promise<BenchInstance[]> {
  const found: BenchInstance[] = [];
  const missing: string[] = [];
  for (const id of taskIds) {
    try {
      found.push(await loadGreenfieldTask(id));
    } catch (err) {
      missing.push(id);
      // eslint-disable-next-line no-console
      console.warn(
        `[bench] failed to load greenfield task ${id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bench] ${missing.length} greenfield task(s) unavailable: ${missing.join(', ')}`,
    );
  }
  return found;
}
```

- [ ] **Step 2: Wire it into `suites.ts`**

In `packages/runtime/bench/src/suites.ts`, add the import:

```ts
import { loadDeepSweInstances } from './deepswe.js';
import { loadGreenfieldInstances } from './greenfield.js';
```

Change `SuiteCatalogEntry['kind']`:

```ts
export interface SuiteCatalogEntry {
  id: string;
  path: string;
  kind: 'swebench' | 'deepswe' | 'greenfield';
  ...
```

In `loadSuiteInstances`, add a branch before the SWE-bench fallback:

```ts
export async function loadSuiteInstances(
  suite: SuiteDefinition,
  instanceIds: string[],
): Promise<BenchInstance[]> {
  const kind = suiteKind(suite);
  if (kind === 'deepswe') {
    const instances = await loadDeepSweInstances(instanceIds);
    return instances;
  }
  if (kind === 'greenfield') {
    return loadGreenfieldInstances(instanceIds);
  }
  if (!suite.dataset || !suite.split) {
    throw new Error('SWE-bench suite requires dataset and split fields');
  }
  ...
```

In `listSuiteCatalog`, update the `evalCommand` ternary:

```ts
      evalCommand:
        kind === 'deepswe'
          ? 'pnpm bench:eval:deepswe'
          : kind === 'greenfield'
            ? 'pnpm bench:eval:greenfield'
            : 'pnpm bench:eval',
```

- [ ] **Step 3: Type-check**

```bash
cd packages/runtime && pnpm exec tsc --noEmit -p .
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/bench/src/greenfield.ts packages/runtime/bench/src/suites.ts
git commit -m "bench: add greenfield fixture loader and wire into suite catalog"
```

---

### Task 3: Task-message branch for greenfield instances

**Files:**
- Modify: `packages/runtime/bench/src/run-instance.ts`

**Interfaces:**
- Consumes: `instance.suite === 'greenfield'`, `instance.test_command` (unused in the message — grading tests stay hidden from the agent by design) from Tasks 1–2.
- Produces: the task message the runtime receives for a greenfield instance; no other task depends on this beyond the manual end-to-end run in Task 5.

- [ ] **Step 1: Add the greenfield branch to `buildTaskMessage`**

In `packages/runtime/bench/src/run-instance.ts`, inside `buildTaskMessage`, add a new branch after the existing `if (instance.suite === 'deepswe') { ... }` block and before the SWE-bench fallback (`if (options?.preflight) { ... fix a bug ... }`):

```ts
  if (instance.suite === 'greenfield') {
    if (options?.preflight) {
      return [
        header,
        '',
        `Build the feature described below from scratch in ${instance.repo}.`,
        '',
        'The repository is already cloned at `repo/` and checked out at the base',
        'commit. It is an empty scaffold: stub functions that throw "not implemented".',
        'Implement every function so the full described behavior below is correct —',
        'cover every case mentioned, not just the headline case. Grading tests are',
        'supplied separately after you finish: do NOT create files under a `tests/`',
        'directory and do not modify the `test` script in `package.json`. Do not open',
        'a pull request; leave your implementation in the working tree.',
        '',
        instance.problem_statement,
      ].join('\n');
    }

    return [
      header,
      '',
      `Build the feature described below from scratch in ${instance.repo}.`,
      '',
      'Setup (do this first, exactly):',
      `1. Clone ${repoUrl} into your workspace.`,
      `2. Check out the exact base commit ${instance.base_commit}.`,
      '',
      'The repository is an empty scaffold: stub functions that throw "not implemented".',
      'Implement every function so the full described behavior below is correct —',
      'cover every case mentioned, not just the headline case. Grading tests are',
      'supplied separately after you finish: do NOT create files under a `tests/`',
      'directory and do not modify the `test` script in `package.json`. Do not open',
      'a pull request; leave your implementation in the working tree.',
      '',
      instance.problem_statement,
    ].join('\n');
  }
```

- [ ] **Step 2: Type-check**

The root `tsconfig.json`'s `include` is `src/**/*` only, so `tsc --noEmit -p .` silently does not check `bench/src` — confirmed while executing this plan (Task 2 caught two type errors this command misses entirely). Use an explicit invocation covering `bench/src` instead, mirroring the root tsconfig's compiler options:

```bash
cd packages/runtime && pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --resolveJsonModule --forceConsistentCasingInFileNames --types node $(find bench/src -name '*.ts' ! -name '*.test.ts')
```

Expected: no new errors. One pre-existing, out-of-scope error is expected and must NOT be fixed here — `bench/src/dataset.ts(20,3): error TS2741: Property 'suite' is missing...` — it predates this plan (present at the branch's merge-base, `git show e3c442a:packages/runtime/bench/src/dataset.ts`) and is unrelated to greenfield work.

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/bench/src/run-instance.ts
git commit -m "bench: build-from-scratch task message for greenfield instances"
```

---

### Task 4: The `greenfield-todo-store` fixture

**Files:**
- Create: `packages/runtime/bench/tasks/greenfield/greenfield-todo-store/meta.json`
- Create: `packages/runtime/bench/tasks/greenfield/greenfield-todo-store/spec.md`
- Create: `packages/runtime/bench/tasks/greenfield/greenfield-todo-store/scaffold/package.json`
- Create: `packages/runtime/bench/tasks/greenfield/greenfield-todo-store/scaffold/src/store.js`
- Create: `packages/runtime/bench/tasks/greenfield/greenfield-todo-store/scaffold/src/persistence.js`
- Create: `packages/runtime/bench/tasks/greenfield/greenfield-todo-store/scaffold/src/index.js`
- Create: `packages/runtime/bench/tasks/greenfield/greenfield-todo-store/hidden/tests/store.test.js`

**Interfaces:**
- Consumes: nothing (a fixture is standalone data).
- Produces: the fixture Task 2's loader reads (`meta.json`, `spec.md`, `scaffold/`) and Task 6's grader reads (`hidden/`).

- [ ] **Step 1: `meta.json`**

```json
{
  "task_id": "greenfield-todo-store",
  "display_title": "Build a todo list library",
  "test_command": "node --test tests/"
}
```

- [ ] **Step 2: `spec.md`** — the goal text the agent receives, written per the specific/testable/full-behavior guidance from `docs/guides/writing-good-goals.md`

```markdown
Build a small todo-list library in this scaffold. Implement `src/store.js` and `src/persistence.js` per their stub signatures — do not change the exported names or `src/index.js`.

Required behavior:

1. `TodoStore#addTodo(text)` creates a todo `{ id, text, completed: false }` with a unique auto-incrementing numeric `id`, and returns it. It must throw if `text` is empty or whitespace-only.
2. `TodoStore#completeTodo(id)` marks the matching todo's `completed` as `true`. It must throw if no todo has that `id`.
3. `TodoStore#removeTodo(id)` removes the matching todo from the store. It must throw if no todo has that `id`.
4. `TodoStore#listTodos(options)` returns an array of todos sorted by `id` ascending. By default (no options, or `{ includeCompleted: false }`) it excludes completed todos. With `{ includeCompleted: true }` it returns every todo, completed or not.
5. `saveToFile(filePath, store)` (in `src/persistence.js`) writes all of `store`'s todos (including completed ones) to `filePath` as JSON.
6. `loadFromFile(filePath)` reads a file written by `saveToFile` and returns a new `TodoStore` populated with the same todos, preserving each todo's `id`, `text`, and `completed` state.

Verify with `npm test` (runs `node --test tests/` once the grading tests are present — you will not see them, so implement exactly the behavior above, not just enough to pass whatever you can observe).
```

- [ ] **Step 3: `scaffold/package.json`**

```json
{
  "name": "greenfield-todo-store",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 4: `scaffold/src/store.js`**

```js
export class TodoStore {
  constructor() {
    this.todos = [];
    this.nextId = 1;
  }

  addTodo(text) {
    throw new Error('not implemented');
  }

  completeTodo(id) {
    throw new Error('not implemented');
  }

  removeTodo(id) {
    throw new Error('not implemented');
  }

  listTodos(options = {}) {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 5: `scaffold/src/persistence.js`**

```js
export async function saveToFile(filePath, store) {
  throw new Error('not implemented');
}

export async function loadFromFile(filePath) {
  throw new Error('not implemented');
}
```

- [ ] **Step 6: `scaffold/src/index.js`**

```js
export { TodoStore } from './store.js';
export { saveToFile, loadFromFile } from './persistence.js';
```

- [ ] **Step 7: `hidden/tests/store.test.js`** — never shown to the agent; overlaid onto its patch at grading time (Task 6)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TodoStore } from '../src/store.js';
import { saveToFile, loadFromFile } from '../src/persistence.js';

test('addTodo returns a todo with an id, the text, and completed=false', () => {
  const store = new TodoStore();
  const todo = store.addTodo('write plan');
  assert.equal(todo.text, 'write plan');
  assert.equal(todo.completed, false);
  assert.equal(typeof todo.id, 'number');
});

test('addTodo rejects empty or whitespace-only text', () => {
  const store = new TodoStore();
  assert.throws(() => store.addTodo(''));
  assert.throws(() => store.addTodo('   '));
});

test('listTodos excludes completed todos by default', () => {
  const store = new TodoStore();
  const a = store.addTodo('a');
  const b = store.addTodo('b');
  store.completeTodo(a.id);
  const open = store.listTodos();
  assert.equal(open.length, 1);
  assert.equal(open[0].id, b.id);
});

test('listTodos({ includeCompleted: true }) returns everything sorted by id', () => {
  const store = new TodoStore();
  const a = store.addTodo('a');
  const b = store.addTodo('b');
  store.completeTodo(a.id);
  const all = store.listTodos({ includeCompleted: true });
  assert.deepEqual(all.map((t) => t.id), [a.id, b.id]);
});

test('completeTodo throws for an unknown id', () => {
  const store = new TodoStore();
  assert.throws(() => store.completeTodo(999));
});

test('removeTodo removes the todo and throws for an unknown id', () => {
  const store = new TodoStore();
  const a = store.addTodo('a');
  store.removeTodo(a.id);
  assert.equal(store.listTodos({ includeCompleted: true }).length, 0);
  assert.throws(() => store.removeTodo(a.id));
});

test('saveToFile then loadFromFile round-trips all todos including completed state', async () => {
  const store = new TodoStore();
  const a = store.addTodo('a');
  store.addTodo('b');
  store.completeTodo(a.id);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-'));
  const file = path.join(dir, 'todos.json');
  await saveToFile(file, store);
  const loaded = await loadFromFile(file);

  const all = loaded.listTodos({ includeCompleted: true });
  assert.equal(all.length, 2);
  assert.equal(all.find((t) => t.id === a.id).completed, true);
});
```

- [ ] **Step 8: Sanity-check the hidden tests against a correct implementation**

This is the one place a mistake would silently make the fixture ungradeable (a wrong assertion would fail even a correct solution). The files from Steps 1–7 are new and not yet in git's index, so `git checkout --` cannot restore them later unless they're staged first — stage the fixture directory now, before making any temporary edit, so the stub content can be recovered afterward:

```bash
cd /path/to/artificer   # repo root
git add packages/runtime/bench/tasks/greenfield/greenfield-todo-store
```

Then, from the scaffold directory, temporarily fill in `scaffold/src/store.js` and `scaffold/src/persistence.js` with a correct implementation, copy `hidden/tests/store.test.js` into a local `tests/` dir next to them, and run:

```bash
cd packages/runtime/bench/tasks/greenfield/greenfield-todo-store/scaffold
mkdir -p tests && cp ../hidden/tests/store.test.js tests/
node --test tests/
```

Expected: all 7 tests pass. Then revert the scaffold files back to the "not implemented" stubs from Steps 4–5 using the copy staged above, and delete the temporary `tests/` directory (`rm -rf tests`) — the committed scaffold must stay unimplemented:

```bash
git checkout -- src/store.js src/persistence.js
rm -rf tests
```

Confirm the revert worked before continuing: `grep -c "not implemented" src/store.js src/persistence.js` should show throws in both files, and `git status` (from the repo root) should show no diff against what was just staged.

- [ ] **Step 9: Commit**

```bash
cd /path/to/artificer   # repo root
git add packages/runtime/bench/tasks/greenfield/greenfield-todo-store
git commit -m "bench: add greenfield-todo-store fixture"
```

---

### Task 5: Suite definition and package.json scripts

**Files:**
- Create: `packages/runtime/bench/tasks/greenfield-mini.json`
- Modify: `packages/runtime/package.json`

**Interfaces:**
- Consumes: `greenfield-todo-store` instance id from Task 4.
- Produces: `pnpm bench:greenfield` / `pnpm bench:eval:greenfield` / `pnpm bench:full:greenfield`, used in Task 6's end-to-end verification.

- [ ] **Step 1: `bench/tasks/greenfield-mini.json`**

```json
{
  "kind": "greenfield",
  "name": "Greenfield build mini (1 task)",
  "description": "From-scratch multi-file build tasks, graded against hidden acceptance tests supplied only after implementation.",
  "instanceIds": ["greenfield-todo-store"]
}
```

- [ ] **Step 2: Add scripts to `packages/runtime/package.json`**

Add these entries next to the existing `bench:deepswe*` block (same pattern: run / eval / report / full):

```json
    "bench:greenfield": "tsx bench/src/main.ts --suite tasks/greenfield-mini.json --preset async-economy",
    "bench:eval:greenfield": "bash bench/eval/run-greenfield-eval.sh",
    "bench:greenfield:report": "BENCH_RESULTS_DIR=bench/results/async-economy/greenfield-mini tsx bench/src/report.ts",
    "bench:full:greenfield": "pnpm bench:greenfield && pnpm bench:eval:greenfield && pnpm bench:greenfield:report",
```

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/bench/tasks/greenfield-mini.json packages/runtime/package.json
git commit -m "bench: add greenfield-mini suite and npm scripts"
```

---

### Task 6: Greenfield grader

**Files:**
- Create: `packages/runtime/bench/src/eval-greenfield.ts`
- Create: `packages/runtime/bench/eval/run-greenfield-eval.sh`

**Interfaces:**
- Consumes: `predictions.jsonl` (existing driver output, unchanged shape: `{instance_id, model_name_or_path, model_patch}`), the scaffold repo materialized under `CACHE_DIR/greenfield/<id>/repo` by Task 2's loader, `hidden/` and `meta.json` from Task 4's fixture.
- Produces: `results/eval-report.json`, same shape `report.ts` already consumes (no changes needed there, per Global Constraints).

- [ ] **Step 1: Write the grader**

Create `packages/runtime/bench/src/eval-greenfield.ts`, modeled directly on `eval-deepswe.ts` but Docker-free:

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RESULTS_DIR } from './config.js';
import { GREENFIELD_FIXTURES_DIR, copyDir } from './greenfield.js';
import { CACHE_DIR } from './config.js';

const execFileAsync = promisify(execFile);

interface Prediction {
  instance_id: string;
  model_patch: string;
}

interface GreenfieldMeta {
  test_command: string;
}

interface EvalReport {
  run_id: string;
  resolved_instances: number;
  unresolved_instances: number;
  empty_patch_instances: number;
  error_instances: number;
  completed_instances: number;
  resolved_ids: string[];
  unresolved_ids: string[];
  empty_patch_ids: string[];
  error_ids: string[];
  completed_ids: string[];
  schema_version: number;
}

async function readPredictions(file: string): Promise<Prediction[]> {
  const raw = await fs.readFile(file, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Prediction);
}

type Verdict = 'resolved' | 'unresolved' | 'empty_patch' | 'error';

async function gradeOne(instanceId: string, patch: string): Promise<Verdict> {
  if (!patch.trim()) return 'empty_patch';

  const scaffoldRepo = path.join(CACHE_DIR, 'greenfield', instanceId, 'repo');
  const fixtureDir = path.join(GREENFIELD_FIXTURES_DIR, instanceId);
  let meta: GreenfieldMeta;
  try {
    meta = JSON.parse(
      await fs.readFile(path.join(fixtureDir, 'meta.json'), 'utf8'),
    );
    await fs.access(scaffoldRepo);
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[greenfield-eval] skip ${instanceId}: scaffold not cached (run bench first)`,
    );
    return 'error';
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'greenfield-eval-'));
  const patchFile = path.join(tmp, 'model.patch');
  await fs.writeFile(patchFile, patch, 'utf8');
  const workdir = path.join(tmp, 'repo');

  // eslint-disable-next-line no-console
  console.log(`[greenfield-eval] grading ${instanceId}`);

  try {
    await execFileAsync('git', ['clone', '-q', scaffoldRepo, workdir]);
    await execFileAsync('git', ['apply', '--whitespace=nowarn', patchFile], {
      cwd: workdir,
    });
    await copyDir(path.join(fixtureDir, 'hidden'), workdir);
    await execFileAsync('sh', ['-c', meta.test_command], {
      cwd: workdir,
      timeout: 120_000,
    });
    return 'resolved';
  } catch {
    return 'unresolved';
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const resultsDir = process.env.BENCH_RESULTS_DIR ?? RESULTS_DIR;
  const predictionsPath = path.join(resultsDir, 'predictions.jsonl');
  const predictions = await readPredictions(predictionsPath);

  const report: EvalReport = {
    run_id: process.env.RUN_ID ?? 'artificer-greenfield',
    resolved_instances: 0,
    unresolved_instances: 0,
    empty_patch_instances: 0,
    error_instances: 0,
    completed_instances: 0,
    resolved_ids: [],
    unresolved_ids: [],
    empty_patch_ids: [],
    error_ids: [],
    completed_ids: [],
    schema_version: 2,
  };

  for (const p of predictions) {
    const verdict = await gradeOne(p.instance_id, p.model_patch);
    if (verdict === 'resolved') {
      report.resolved_ids.push(p.instance_id);
      report.completed_ids.push(p.instance_id);
    } else if (verdict === 'unresolved') {
      report.unresolved_ids.push(p.instance_id);
      report.completed_ids.push(p.instance_id);
    } else if (verdict === 'empty_patch') {
      report.empty_patch_ids.push(p.instance_id);
    } else {
      report.error_ids.push(p.instance_id);
    }
  }

  report.resolved_instances = report.resolved_ids.length;
  report.unresolved_instances = report.unresolved_ids.length;
  report.empty_patch_instances = report.empty_patch_ids.length;
  report.error_instances = report.error_ids.length;
  report.completed_instances = report.completed_ids.length;

  await fs.writeFile(
    path.join(resultsDir, 'eval-report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  // eslint-disable-next-line no-console
  console.log(
    `[greenfield-eval] resolved=${report.resolved_instances} ` +
      `unresolved=${report.unresolved_instances} -> ${path.join(resultsDir, 'eval-report.json')}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[greenfield-eval] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Write the shell wrapper**

Create `packages/runtime/bench/eval/run-greenfield-eval.sh` (copy the pattern of `run-deepswe-eval.sh` exactly):

```bash
#!/usr/bin/env bash
# Grade greenfield predictions locally (no Docker) using cached fixture scaffolds.
set -euo pipefail
EVAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "${EVAL_DIR}/.." && pwd)"
cd "${BENCH_DIR}/.."
pnpm exec tsx bench/src/eval-greenfield.ts "$@"
```

```bash
chmod +x packages/runtime/bench/eval/run-greenfield-eval.sh
```

- [ ] **Step 3: Type-check**

`tsc --noEmit -p .` does not cover `bench/src` (see Task 3's Step 2 note). Use the same explicit invocation:

```bash
cd packages/runtime && pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --resolveJsonModule --forceConsistentCasingInFileNames --types node $(find bench/src -name '*.ts' ! -name '*.test.ts')
```

Expected: no new errors (the one pre-existing `dataset.ts` error from Task 3's Step 2 note is expected and out of scope).

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/bench/src/eval-greenfield.ts packages/runtime/bench/eval/run-greenfield-eval.sh
git commit -m "bench: add Docker-free grader for greenfield tasks"
```

---

### Task 7: End-to-end verification and docs

**Files:**
- Modify: `packages/runtime/bench/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing further consumed — this is the plan's last task.

- [ ] **Step 1: Run the suite end-to-end**

From `packages/runtime`, with runtime credentials configured per the existing bench prerequisites:

```bash
pnpm bench:full:greenfield
```

Expected: the driver clones the materialized scaffold repo (from `CACHE_DIR/greenfield/greenfield-todo-store/repo`), the agent implements `src/store.js` / `src/persistence.js`, `bench:eval:greenfield` overlays `hidden/tests/store.test.js` and runs `node --test tests/` against the agent's patch, and `results/eval-report.json` records the instance under either `resolved_ids` or `unresolved_ids` (not `error_ids` — an `error` verdict means the harness itself is broken, e.g. scaffold not cached, and should be treated as a bug in Tasks 1–6, not a benchmark result).

- [ ] **Step 2: Confirm the empty-patch and error paths degrade correctly**

Sanity-check the grader's edge cases directly (fast, no LLM calls):

```bash
cd packages/runtime
node -e "
const { execFileSync } = require('child_process');
" 2>/dev/null || true
mkdir -p /tmp/greenfield-eval-check
cat > /tmp/greenfield-eval-check/predictions.jsonl <<'EOF'
{"instance_id":"greenfield-todo-store","model_name_or_path":"test","model_patch":""}
EOF
BENCH_RESULTS_DIR=/tmp/greenfield-eval-check pnpm exec tsx bench/src/eval-greenfield.ts
cat /tmp/greenfield-eval-check/eval-report.json
```

Expected: `empty_patch_ids` contains `greenfield-todo-store`, `resolved_instances` and `unresolved_instances` are both `0`.

- [ ] **Step 3: Update `bench/README.md`**

Add a row to the suite table (the table currently lists `mini-suite.json`, `deepswe-mini-suite.json`, `deepswe-typescript-mini.json`):

```markdown
| `greenfield-mini.json` | Greenfield build tasks (1 instance), graded Docker-free against hidden acceptance tests | `pnpm bench:eval:greenfield` |
```

Add a new subsection after the existing suite table, before "## Outputs (`results/`)":

```markdown
## Greenfield build tasks

Unlike the SWE-bench and DeepSWE suites (fix a bug in an existing repo), greenfield
tasks measure sustained *build-from-scratch* work: the agent gets a stub scaffold
and a spec, and must implement multiple files across however many plan/implement/
review cycles it takes. Grading tests are never shown to the agent — they're
overlaid onto its patch only at eval time, the same hide-until-grading approach
SWE-bench uses for its official test patch.

Add a new task by creating `bench/tasks/greenfield/<task-id>/` with:

```
<task-id>/
├── meta.json      # { task_id, display_title, test_command }
├── spec.md        # the goal text the agent receives
├── scaffold/      # stub files (plain ESM JS, no deps) the agent implements — this becomes the cloned repo
└── hidden/        # overlaid onto the agent's patch only at grading time; never sent to the agent
```

Fixtures are plain ESM JavaScript with no npm dependencies (graded via `node --test`)
so eval never needs `npm install` or Docker. Add the new task id to a suite file's
`instanceIds` (or create a new suite file) to include it in a run.
```

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/bench/README.md
git commit -m "docs: document the greenfield bench suite"
```

## Self-Review Notes

- **Spec coverage:** loader (Task 2), task-message branch (Task 3), fixture (Task 4), suite/scripts (Task 5), grader (Task 6), and docs/e2e verification (Task 7) together cover the full "add a new bench suite kind" surface identified during research — confirmed against the single branch point in `run-instance.ts` and the suite-agnostic `report.ts`.
- **Placeholder scan:** no TBDs; the one deliberate scope boundary (ship one fixture, not three) is stated as a Global Constraint and documented in the README, not left as an in-code TODO.
- **Type consistency:** `BenchInstance.test_command` (Task 1) is read in `greenfield.ts` (Task 2) and `eval-greenfield.ts` (Task 6) under the same name; `GREENFIELD_FIXTURES_DIR` and `copyDir` are exported once from `greenfield.ts` (Task 2) and imported, not redefined, in `eval-greenfield.ts` (Task 6).
