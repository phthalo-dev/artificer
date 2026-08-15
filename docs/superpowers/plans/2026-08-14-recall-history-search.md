# Recall / History Search (`search_history`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `search_history` tool that lets `communicator`, `planner`, and `librarian` search past run outcomes (planner/worker/reviewer/librarian call history), closing the gap `query_memories` (curated long-term memory) and `get_recent_messages` (the outward chat thread) don't cover.

**Architecture:** A lightweight `history/index.json` (mirroring the existing `memories/index.json` pattern) holds one small excerpt entry per *terminal* run (`status: 'done' | 'failed'`), upserted internally by `Store.saveRun()` whenever a run reaches that terminal state. `Store.searchHistory()` reads that index, applies optional role/workstream/status filters, and ranks with a new `rankRuns()` function that reuses `memory-search.ts`'s `tokenize()` and Fuse.js scoring approach. A new `search_history` tool exposes it.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node's built-in `node:test` + `node:assert/strict`, `fuse.js` (already a dependency, used by `memory-search.ts`).

## Global Constraints

- No database — file-backed only, matching every other piece of `Store`.
- No auto-injection into context — this is a pull tool the model calls, like `query_memories`. No signpost.
- `toolCalls` never enter the index — only `task`/`output`/`error` excerpts.
- `get_recent_messages` (`packages/runtime/src/tools/communication.ts`) is untouched — out of scope.
- No embeddings in this plan — pure lexical (Fuse.js), matching `query_memories`'s default.
- Only `communicator`, `planner`, `librarian` get the tool — not `worker`/`reviewer`.
- Excerpt lengths: task ≤200 chars, output ≤300 chars (pinned here, per the spec's note that these are implementation-time constants).
- Fuse threshold: `0.4`, matching `memory-search.ts`, for consistent recall quality across both search tools.

**Reference:** [docs/superpowers/specs/2026-08-13-recall-history-search-design.md](../specs/2026-08-13-recall-history-search-design.md)

---

## Task 1: History index data model & ranking (`history-search.ts`)

**Files:**
- Create: `packages/runtime/src/storage/history-search.ts`
- Test: `packages/runtime/src/storage/history-search.test.ts`

**Interfaces:**
- Consumes: `tokenize(text: string): string[]` from `./memory-search.js` (already exported)
- Produces:
  - `interface RunIndexEntry { id: string; role: string; status: 'done' | 'failed'; workstreamId?: string; model?: string; taskExcerpt: string; outputExcerpt: string; createdAt: string }`
  - `interface RankedRunEntry { entry: RunIndexEntry; score: number }`
  - `function buildRunIndexEntry(run: RunRecord): RunIndexEntry`
  - `function rankRuns(query: string, entries: RunIndexEntry[]): RankedRunEntry[]`
  - `const TASK_EXCERPT_MAX = 200`, `const OUTPUT_EXCERPT_MAX = 300` (exported constants)

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/runtime/src/storage/history-search.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRunIndexEntry,
  rankRuns,
  TASK_EXCERPT_MAX,
  OUTPUT_EXCERPT_MAX,
  type RunIndexEntry,
} from './history-search.js';
import type { RunRecord } from './types.js';

function minimalRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run_1',
    role: 'worker',
    task: 'Fix the auth redirect loop in login.ts',
    status: 'done',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 0,
    },
    output: 'Replaced the stale session check with a fresh token lookup.',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('buildRunIndexEntry excerpts task and output, drops toolCalls/usage', () => {
  const run = minimalRun({
    toolCalls: [{ name: 'read_file', input: {}, output: 'x', at: 't' }],
    workstreamId: 'ws_1',
    model: 'gpt-5',
  });
  const entry = buildRunIndexEntry(run);
  assert.equal(entry.id, 'run_1');
  assert.equal(entry.role, 'worker');
  assert.equal(entry.status, 'done');
  assert.equal(entry.workstreamId, 'ws_1');
  assert.equal(entry.model, 'gpt-5');
  assert.equal(entry.taskExcerpt, 'Fix the auth redirect loop in login.ts');
  assert.equal(
    entry.outputExcerpt,
    'Replaced the stale session check with a fresh token lookup.',
  );
  assert.equal(entry.createdAt, '2026-01-01T00:00:00.000Z');
  assert.ok(!('toolCalls' in entry));
  assert.ok(!('usage' in entry));
});

test('buildRunIndexEntry truncates long task/output to the excerpt max lengths', () => {
  const run = minimalRun({
    task: 'x'.repeat(500),
    output: 'y'.repeat(500),
  });
  const entry = buildRunIndexEntry(run);
  assert.equal(entry.taskExcerpt.length, TASK_EXCERPT_MAX);
  assert.equal(entry.outputExcerpt.length, OUTPUT_EXCERPT_MAX);
});

test('buildRunIndexEntry falls back to error when output is empty on a failed run', () => {
  const run = minimalRun({
    status: 'failed',
    output: undefined,
    error: 'Tests failed: 2 assertions did not pass.',
  });
  const entry = buildRunIndexEntry(run);
  assert.equal(entry.status, 'failed');
  assert.equal(entry.outputExcerpt, 'Tests failed: 2 assertions did not pass.');
});

test('buildRunIndexEntry produces an empty outputExcerpt when neither output nor error is set', () => {
  const run = minimalRun({ output: undefined, error: undefined });
  const entry = buildRunIndexEntry(run);
  assert.equal(entry.outputExcerpt, '');
});

test('rankRuns: empty query returns all entries in recency order', () => {
  const entries: RunIndexEntry[] = [
    {
      id: 'a',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'older',
      outputExcerpt: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'b',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'newer',
      outputExcerpt: '',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const ranked = rankRuns('', entries);
  assert.deepEqual(
    ranked.map((r) => r.entry.id),
    ['b', 'a'],
  );
});

test('rankRuns: matches by task text and ranks the closer match first', () => {
  const entries: RunIndexEntry[] = [
    {
      id: 'auth-fix',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'Fix the auth redirect loop in login.ts',
      outputExcerpt: 'Replaced the stale session check.',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'unrelated',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'Update the changelog for the release',
      outputExcerpt: 'Bumped version and added notes.',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const ranked = rankRuns('auth redirect', entries);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].entry.id, 'auth-fix');
});

test('rankRuns: a query of only stopwords falls back to recency order', () => {
  const entries: RunIndexEntry[] = [
    {
      id: 'a',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'task a',
      outputExcerpt: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'b',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'task b',
      outputExcerpt: '',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const ranked = rankRuns('the of', entries);
  assert.deepEqual(
    ranked.map((r) => r.entry.id),
    ['b', 'a'],
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/runtime/`): `node --import tsx --test src/storage/history-search.test.ts`
Expected: FAIL — `history-search.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Write the implementation**

```typescript
// packages/runtime/src/storage/history-search.ts
import Fuse from 'fuse.js';
import { tokenize } from './memory-search.js';
import type { RunRecord } from './types.js';

/** Compact, searchable record for one terminal run; the full record lives in runs/<id>.json. */
export interface RunIndexEntry {
  id: string;
  role: string;
  status: 'done' | 'failed';
  workstreamId?: string;
  model?: string;
  /** First TASK_EXCERPT_MAX chars of the run's task. */
  taskExcerpt: string;
  /** First OUTPUT_EXCERPT_MAX chars of the run's output (or error, if output is empty). */
  outputExcerpt: string;
  createdAt: string;
}

export interface RankedRunEntry {
  entry: RunIndexEntry;
  score: number;
}

export const TASK_EXCERPT_MAX = 200;
export const OUTPUT_EXCERPT_MAX = 300;

/** Build the lightweight index entry for a terminal run. Never copies toolCalls/usage. */
export function buildRunIndexEntry(run: RunRecord): RunIndexEntry {
  const status = run.status === 'failed' ? 'failed' : 'done';
  const outputSource = run.output || run.error || '';
  const entry: RunIndexEntry = {
    id: run.id,
    role: run.role,
    status,
    taskExcerpt: run.task.slice(0, TASK_EXCERPT_MAX),
    outputExcerpt: outputSource.slice(0, OUTPUT_EXCERPT_MAX),
    createdAt: run.createdAt,
  };
  if (run.workstreamId) entry.workstreamId = run.workstreamId;
  if (run.model) entry.model = run.model;
  return entry;
}

const FUSE_KEYS: Array<{ name: keyof RunIndexEntry; weight: number }> = [
  { name: 'taskExcerpt', weight: 0.6 },
  { name: 'outputExcerpt', weight: 0.4 },
];

const FUSE_THRESHOLD = 0.4;

/**
 * Keyword/fuzzy ranking over run excerpts, mirroring rankMemories' approach
 * (memory-search.ts) with no tag boost — runs have no tags. An empty query
 * (or a query that tokenizes to nothing, e.g. all stopwords) returns all
 * entries in recency order.
 */
export function rankRuns(
  query: string,
  entries: RunIndexEntry[],
): RankedRunEntry[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) {
    return [...entries]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => ({ entry, score: 0 }));
  }

  const fuse = new Fuse(entries, {
    keys: FUSE_KEYS,
    threshold: FUSE_THRESHOLD,
    includeScore: true,
    ignoreLocation: true,
  });

  const bestFuse = new Map<string, number>();
  for (const token of qTokens) {
    for (const hit of fuse.search(token)) {
      const dist = hit.score ?? 1;
      const prev = bestFuse.get(hit.item.id);
      if (prev === undefined || dist < prev) {
        bestFuse.set(hit.item.id, dist);
      }
    }
  }

  const scored: RankedRunEntry[] = [];
  for (const entry of entries) {
    const dist = bestFuse.get(entry.id);
    if (dist === undefined) continue;
    scored.push({ entry, score: 1 - dist });
  }

  return scored.sort(
    (a, b) =>
      b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/storage/history-search.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/storage/history-search.ts packages/runtime/src/storage/history-search.test.ts
git commit -m "runtime: add history-search ranking module for run-record recall"
```

---

## Task 2: `Store` index maintenance (`saveRun` upserts on terminal status)

**Files:**
- Modify: `packages/runtime/src/storage/layout.ts` (add `historyDir`/`historyIndexFile`)
- Modify: `packages/runtime/src/storage/store.ts` (index upsert hooked into `saveRun`)
- Test: `packages/runtime/src/storage/store.test.ts`

**Interfaces:**
- Consumes: `buildRunIndexEntry(run: RunRecord): RunIndexEntry`, `RunIndexEntry` from `./history-search.js` (Task 1)
- Produces: `Store.saveRun(run: RunRecord): Promise<void>` (existing signature, now also indexes on terminal status); private `Store.readHistoryIndex(): Promise<RunIndexEntry[]>` (used by Task 3)

- [ ] **Step 1: Write the failing tests**

Add to `packages/runtime/src/storage/store.test.ts` (after the existing `concurrent saveRun` test). No new imports are needed — `store.layout.historyIndexFile()` is reachable through the `store` instance already imported at the top of the file:

```typescript
test('saveRun indexes a run into history/index.json when it reaches a terminal status', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const run = await store.createRun({ role: 'worker', task: 'Fix the bug' });
  run.status = 'running';
  await store.saveRun(run);

  const raw = await fs.readFile(store.layout.historyIndexFile(), 'utf8').catch(() => null);
  assert.equal(raw, null, 'a running (non-terminal) save must not create the index');

  run.status = 'done';
  run.output = 'Fixed it by adjusting the redirect.';
  await store.saveRun(run);

  const index = JSON.parse(await fs.readFile(store.layout.historyIndexFile(), 'utf8'));
  assert.equal(index.length, 1);
  assert.equal(index[0].id, run.id);
  assert.equal(index[0].status, 'done');
  assert.equal(index[0].taskExcerpt, 'Fix the bug');
  assert.equal(index[0].outputExcerpt, 'Fixed it by adjusting the redirect.');
});

test('saveRun upserts (not duplicates) the same run id across multiple terminal saves', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const run = await store.createRun({ role: 'worker', task: 'Fix the bug' });
  run.status = 'done';
  run.output = 'first pass';
  await store.saveRun(run);

  run.output = 'first pass, corrected';
  await store.saveRun(run);

  const index = JSON.parse(await fs.readFile(store.layout.historyIndexFile(), 'utf8'));
  assert.equal(index.length, 1);
  assert.equal(index[0].outputExcerpt, 'first pass, corrected');
});

test('failed runs are indexed with status "failed" using the error as the output excerpt', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const run = await store.createRun({ role: 'worker', task: 'Fix the bug' });
  run.status = 'failed';
  run.error = 'Tests did not pass.';
  await store.saveRun(run);

  const index = JSON.parse(await fs.readFile(store.layout.historyIndexFile(), 'utf8'));
  assert.equal(index[0].status, 'failed');
  assert.equal(index[0].outputExcerpt, 'Tests did not pass.');
});

test('a corrupt history/index.json is rebuilt from runs/ on the next terminal save', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const older = await store.createRun({ role: 'worker', task: 'Older task' });
  older.status = 'done';
  older.output = 'older output';
  await store.saveRun(older);

  // Corrupt the index on disk.
  await fs.writeFile(store.layout.historyIndexFile(), '{not json', 'utf8');

  const newer = await store.createRun({ role: 'planner', task: 'Newer task' });
  newer.status = 'done';
  newer.output = 'newer output';
  await store.saveRun(newer);

  const index = JSON.parse(await fs.readFile(store.layout.historyIndexFile(), 'utf8'));
  const ids = index.map((e: { id: string }) => e.id).sort();
  assert.deepEqual(ids, [newer.id, older.id].sort());
});
```

Remove the stray `import { historyIndexFile } from './layout.js';` line above before running — it isn't real (`historyIndexFile` is an instance method, accessed as `store.layout.historyIndexFile()`, already used correctly in the test bodies). It's called out here only as a warning against the wrong import; do not add it to the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/storage/store.test.ts`
Expected: FAIL — `store.layout.historyIndexFile` is not a function; `saveRun` doesn't index yet.

- [ ] **Step 3: Implement — `layout.ts` changes**

In `packages/runtime/src/storage/layout.ts`, add this method. There's no `historyDir` getter — unlike `memoriesDir` (which is also used for directory listing in `listMemories()`), the history index is the only file that ever lives under `history/`, so this follows the same direct-path convention as `githubWatchStateFile()`/`scheduleStateFile()`/`quotaStateFile()`:

```typescript
  historyIndexFile(): string {
    return path.join(this.root, 'history', 'index.json');
  }
```

- [ ] **Step 4: Implement — `store.ts` changes**

Add the import at the top of `packages/runtime/src/storage/store.ts`:

```typescript
import {
  buildRunIndexEntry,
  type RunIndexEntry,
} from './history-search.js';
```

Replace the existing `saveRun` method:

```typescript
  async saveRun(run: RunRecord): Promise<void> {
    await writeJson(this.layout.runFile(run.id), run);
    if (run.status === 'done' || run.status === 'failed') {
      await this.upsertHistoryIndexEntry(run);
    }
  }
```

Add these private methods to the `Store` class (near the other memory-index helpers, e.g. after `readReconciledIndex`):

```typescript
  /**
   * Read history/index.json; rebuild it from terminal runs/ files if missing
   * or unparseable. Unlike the memory index, no drift-count reconciliation is
   * needed: runs/ is written exclusively by Store's own createRun/saveRun, so
   * there is no external-mutation path that could cause the index to drift
   * out from under a valid, parseable index.json.
   */
  private async readHistoryIndex(): Promise<RunIndexEntry[]> {
    const file = this.layout.historyIndexFile();
    let raw: string | null = null;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (raw !== null) {
      try {
        return JSON.parse(raw) as RunIndexEntry[];
      } catch {
        // Corrupt index.json — fall through and rebuild from runs/.
      }
    }
    const runs = await this.listRuns();
    const rebuilt = runs
      .filter((r) => r.status === 'done' || r.status === 'failed')
      .map((r) => buildRunIndexEntry(r));
    await writeJson(file, rebuilt);
    return rebuilt;
  }

  private async upsertHistoryIndexEntry(run: RunRecord): Promise<void> {
    const index = await this.readHistoryIndex();
    const entry = buildRunIndexEntry(run);
    const i = index.findIndex((e) => e.id === entry.id);
    if (i === -1) index.push(entry);
    else index[i] = entry;
    await writeJson(this.layout.historyIndexFile(), index);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test src/storage/store.test.ts`
Expected: PASS (all existing tests plus the 4 new ones)

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/storage/layout.ts packages/runtime/src/storage/store.ts packages/runtime/src/storage/store.test.ts
git commit -m "runtime: index terminal runs into history/index.json from saveRun"
```

---

## Task 3: `Store.searchHistory()`

**Files:**
- Modify: `packages/runtime/src/storage/store.ts`
- Test: `packages/runtime/src/storage/store.test.ts`

**Interfaces:**
- Consumes: `Store.readHistoryIndex()` (private, Task 2), `rankRuns(query, entries)` from `./history-search.js` (Task 1)
- Produces: `Store.searchHistory(query: string, opts?: { role?: string; workstreamId?: string; status?: 'done' | 'failed'; limit?: number }): Promise<RunIndexEntry[]>`

- [ ] **Step 1: Write the failing tests**

Add to `packages/runtime/src/storage/store.test.ts`:

```typescript
test('searchHistory ranks by task/output text and respects limit', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const authRun = await store.createRun({ role: 'worker', task: 'Fix auth redirect loop' });
  authRun.status = 'done';
  authRun.output = 'Patched the session check.';
  await store.saveRun(authRun);

  const changelogRun = await store.createRun({ role: 'worker', task: 'Update changelog' });
  changelogRun.status = 'done';
  changelogRun.output = 'Added release notes.';
  await store.saveRun(changelogRun);

  const results = await store.searchHistory('auth redirect');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, authRun.id);
});

test('searchHistory with an empty query returns recent runs, newest first', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const older = await store.createRun({ role: 'worker', task: 'older' });
  older.status = 'done';
  older.createdAt = '2026-01-01T00:00:00.000Z';
  await store.saveRun(older);

  const newer = await store.createRun({ role: 'worker', task: 'newer' });
  newer.status = 'done';
  newer.createdAt = '2026-01-02T00:00:00.000Z';
  await store.saveRun(newer);

  const results = await store.searchHistory('');
  assert.deepEqual(
    results.map((r) => r.id),
    [newer.id, older.id],
  );
});

test('searchHistory filters by role, workstreamId, and status', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const workerRun = await store.createRun({
    role: 'worker',
    task: 'shared task text',
    workstreamId: 'ws_1',
  });
  workerRun.status = 'done';
  await store.saveRun(workerRun);

  const plannerRun = await store.createRun({
    role: 'planner',
    task: 'shared task text',
    workstreamId: 'ws_2',
  });
  plannerRun.status = 'failed';
  await store.saveRun(plannerRun);

  const byRole = await store.searchHistory('', { role: 'planner' });
  assert.deepEqual(byRole.map((r) => r.id), [plannerRun.id]);

  const byWorkstream = await store.searchHistory('', { workstreamId: 'ws_1' });
  assert.deepEqual(byWorkstream.map((r) => r.id), [workerRun.id]);

  const byStatus = await store.searchHistory('', { status: 'failed' });
  assert.deepEqual(byStatus.map((r) => r.id), [plannerRun.id]);
});

test('searchHistory returns an empty array when there is no run history yet', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const results = await store.searchHistory('anything');
  assert.deepEqual(results, []);
});

test('searchHistory limit defaults to 5 and caps at 20', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  for (let i = 0; i < 8; i++) {
    const run = await store.createRun({ role: 'worker', task: `task ${i}` });
    run.status = 'done';
    run.createdAt = `2026-01-01T00:00:0${i}.000Z`;
    await store.saveRun(run);
  }

  const defaultLimit = await store.searchHistory('');
  assert.equal(defaultLimit.length, 5);

  const capped = await store.searchHistory('', { limit: 999 });
  assert.equal(capped.length, 8); // fewer than 20 exist, cap doesn't truncate below actual count
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/storage/store.test.ts`
Expected: FAIL — `store.searchHistory` is not a function.

- [ ] **Step 3: Implement**

Add the import at the top of `packages/runtime/src/storage/store.ts` (extend the Task 2 import):

```typescript
import {
  buildRunIndexEntry,
  rankRuns,
  type RunIndexEntry,
} from './history-search.js';
```

Add this public method to the `Store` class (near `queryMemories`):

```typescript
  /**
   * Search terminal run history (done/failed calls) by task/output text,
   * with optional role/workstream/status filters. Empty query returns the
   * most recent matches in recency order, same convention as queryMemories.
   */
  async searchHistory(
    query: string,
    opts: {
      role?: string;
      workstreamId?: string;
      status?: 'done' | 'failed';
      limit?: number;
    } = {},
  ): Promise<RunIndexEntry[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 5, 20));
    let entries = await this.readHistoryIndex();
    if (opts.role) entries = entries.filter((e) => e.role === opts.role);
    if (opts.workstreamId) {
      entries = entries.filter((e) => e.workstreamId === opts.workstreamId);
    }
    if (opts.status) entries = entries.filter((e) => e.status === opts.status);
    return rankRuns(query, entries)
      .slice(0, limit)
      .map((r) => r.entry);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/storage/store.test.ts`
Expected: PASS (all existing tests plus the 5 new ones)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/storage/store.ts packages/runtime/src/storage/store.test.ts
git commit -m "runtime: add Store.searchHistory with role/workstream/status filters"
```

---

## Task 4: `search_history` tool

**Files:**
- Create: `packages/runtime/src/tools/history.ts`
- Test: `packages/runtime/src/tools/history.test.ts`

**Interfaces:**
- Consumes: `Store.searchHistory(query, opts)` (Task 3), `ToolContext`/`ToolDef` (existing, from `../context.js`/`../llm/types.js`)
- Produces: `function createHistoryTools(ctx: ToolContext): ToolDef[]` — one tool, `search_history`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/runtime/src/tools/history.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ToolContext } from '../context.js';
import { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';
import { createHistoryTools } from './history.js';

async function freshStore(): Promise<Store> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-historytool-'));
  const store = new Store(dir);
  await store.init();
  return store;
}

function ctxFor(store: Store, run: RunRecord): ToolContext {
  return {
    engine: { store } as unknown as ToolContext['engine'],
    run,
    workspaceDir: '/tmp',
  };
}

test('search_history returns "(no run history)" when nothing is indexed yet', async () => {
  const store = await freshStore();
  const run = await store.createRun({ role: 'communicator', task: 'chat' });
  const tools = createHistoryTools(ctxFor(store, run));
  const searchHistory = tools.find((t) => t.name === 'search_history');
  assert.ok(searchHistory, 'search_history tool is present');

  const result = await searchHistory.handler({ query: 'anything' });
  assert.equal(result, '(no run history)');
});

test('search_history finds a matching terminal run and formats role/task/output', async () => {
  const store = await freshStore();
  const workerRun = await store.createRun({
    role: 'worker',
    task: 'Fix auth redirect loop in login.ts',
    workstreamId: 'ws_1',
  });
  workerRun.status = 'done';
  workerRun.output = 'Replaced the stale session check.';
  await store.saveRun(workerRun);

  const callerRun = await store.createRun({ role: 'communicator', task: 'chat' });
  const tools = createHistoryTools(ctxFor(store, callerRun));
  const searchHistory = tools.find((t) => t.name === 'search_history');
  assert.ok(searchHistory);

  const result = await searchHistory.handler({ query: 'auth redirect' });
  assert.match(result, /\[worker\]/);
  assert.match(result, /Fix auth redirect loop in login\.ts/);
  assert.match(result, /workstream ws_1/);
  assert.match(result, /done/);
  assert.match(result, /Replaced the stale session check\./);
});

test('search_history passes role/workstreamId/status/limit filters through to the store', async () => {
  const store = await freshStore();
  const done = await store.createRun({ role: 'worker', task: 'same text' });
  done.status = 'done';
  await store.saveRun(done);

  const failed = await store.createRun({ role: 'worker', task: 'same text' });
  failed.status = 'failed';
  await store.saveRun(failed);

  const callerRun = await store.createRun({ role: 'communicator', task: 'chat' });
  const tools = createHistoryTools(ctxFor(store, callerRun));
  const searchHistory = tools.find((t) => t.name === 'search_history');
  assert.ok(searchHistory);

  const result = await searchHistory.handler({ status: 'failed' });
  assert.match(result, /\(failed\)/);
  assert.doesNotMatch(result, /\(done\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/tools/history.test.ts`
Expected: FAIL — `./history.js` doesn't exist yet.

- [ ] **Step 3: Implement**

```typescript
// packages/runtime/src/tools/history.ts
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

/** Recall tool over past run outcomes (planner/worker/reviewer/librarian calls). */
export function createHistoryTools(ctx: ToolContext): ToolDef[] {
  const { engine } = ctx;
  const { store } = engine;

  return [
    {
      name: 'search_history',
      description:
        'Search past run history (planner/worker/reviewer/librarian calls) by task and outcome. Returns the top matches only. Leave query empty to list the most recent runs.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text.' },
          role: {
            type: 'string',
            description:
              'Optional filter: only runs by this role (e.g. "worker").',
          },
          workstreamId: {
            type: 'string',
            description: 'Optional filter: only runs in this workstream.',
          },
          status: {
            type: 'string',
            enum: ['done', 'failed'],
            description: 'Optional filter: only runs with this outcome.',
          },
          limit: {
            type: 'number',
            description: 'Max runs to return (default 5, max 20).',
          },
        },
      },
      handler: async (input) => {
        const query = input.query ? String(input.query) : '';
        const role = typeof input.role === 'string' ? input.role : undefined;
        const workstreamId =
          typeof input.workstreamId === 'string'
            ? input.workstreamId
            : undefined;
        const status =
          input.status === 'done' || input.status === 'failed'
            ? input.status
            : undefined;
        const limit = typeof input.limit === 'number' ? input.limit : 5;

        const results = await store.searchHistory(query, {
          role,
          workstreamId,
          status,
          limit,
        });
        if (results.length === 0) return '(no run history)';
        return results
          .map((r) => {
            const location = r.workstreamId
              ? ` (workstream ${r.workstreamId}, ${r.status})`
              : ` (${r.status})`;
            return `- [${r.role}] ${r.taskExcerpt}${location}\n  ${r.outputExcerpt}`;
          })
          .join('\n\n');
      },
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/tools/history.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/tools/history.ts packages/runtime/src/tools/history.test.ts
git commit -m "runtime: add search_history tool over run history"
```

---

## Task 5: Wire `search_history` into `communicator`, `planner`, `librarian`

**Files:**
- Modify: `packages/runtime/src/tools/registry.ts`
- Test: `packages/runtime/src/tools/registry.test.ts` (create if it doesn't already exist — check first)

**Interfaces:**
- Consumes: `createHistoryTools(ctx: ToolContext): ToolDef[]` (Task 4)
- Produces: `toolsForRole('communicator' | 'planner' | 'librarian', ctx)` now includes a tool named `search_history`; `toolsForRole('worker' | 'reviewer', ctx)` does not.

- [ ] **Step 1: Check whether a registry test file already exists**

Run: `ls packages/runtime/src/tools/registry.test.ts 2>/dev/null || echo "does not exist"`

If it exists, read it first and add the new tests below in the same style as its existing tests (same `ctxFor`/fixture helpers). If it doesn't exist, create it fresh using the pattern below (mirroring `orchestrator-tool.test.ts`'s fixture setup).

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/runtime/src/tools/registry.test.ts (create, or extend if present)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ToolContext } from '../context.js';
import { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';
import { toolsForRole } from './registry.js';

async function freshCtx(role: RunRecord['role']): Promise<ToolContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-registry-'));
  const store = new Store(dir);
  await store.init();
  const run = await store.createRun({ role, task: 't' });
  return {
    engine: { store } as unknown as ToolContext['engine'],
    run,
    workspaceDir: '/tmp',
  };
}

for (const role of ['communicator', 'planner', 'librarian']) {
  test(`toolsForRole('${role}') includes search_history`, async () => {
    const ctx = await freshCtx(role);
    const tools = toolsForRole(role, ctx);
    assert.ok(
      tools.some((t) => t.name === 'search_history'),
      `${role} should have search_history`,
    );
  });
}

for (const role of ['worker', 'reviewer']) {
  test(`toolsForRole('${role}') does not include search_history`, async () => {
    const ctx = await freshCtx(role);
    const tools = toolsForRole(role, ctx);
    assert.ok(
      !tools.some((t) => t.name === 'search_history'),
      `${role} should not have search_history`,
    );
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --import tsx --test src/tools/registry.test.ts`
Expected: FAIL — `communicator`/`planner`/`librarian` tool lists don't include `search_history` yet.

- [ ] **Step 4: Implement**

In `packages/runtime/src/tools/registry.ts`:

Add the import:

```typescript
import { createHistoryTools } from './history.js';
```

Add the tool-set construction near the other `create*Tools(ctx)` calls inside `toolsForRole`:

```typescript
  const history = createHistoryTools(ctx);
```

Add `...history` to the three role branches:

```typescript
    case 'communicator':
      result = [
        ...reply,
        ...communicator,
        ...messageHistory,
        ...providerConfig,
        ...schedules,
        ...history,
        ...byName(orchestrator, ['get_status', 'query_memories', 'add_memory']),
      ];
      break;
```

```typescript
    case 'planner':
      result = [
        ...files,
        ...edit,
        ...searchAll,
        ...toolResultRead,
        ...shell,
        ...git,
        ...byName(artifacts, ['write_plan', 'read_plan']),
        ...history,
        ...byName(orchestrator, [
          'get_status',
          'query_memories',
          'add_memory',
          'record_finding',
        ]),
      ];
      break;
```

```typescript
    case 'librarian':
      result = [
        ...fetchTools,
        ...reply,
        ...history,
        ...byName(orchestrator, ['query_memories', 'add_memory']),
        ...createLearnBatchTools(ctx),
      ];
      break;
```

Leave the `orchestrator`, `reviewer`, and `worker` branches untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test src/tools/registry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the full runtime test suite**

Run (from `packages/runtime/`): `pnpm test`
Expected: PASS — no regressions in any other test file (in particular `orchestrator-tool.test.ts`, `store.test.ts`, `memory-search.test.ts`, and any existing tool-registry coverage).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/tools/registry.ts packages/runtime/src/tools/registry.test.ts
git commit -m "runtime: wire search_history into communicator/planner/librarian"
```

---

## Task 6: Document the tool

**Files:**
- Modify: `docs/guides/managing-memories.md` (add a short section distinguishing `search_history` from `query_memories`)

**Interfaces:**
- Consumes: nothing new — this is documentation only, describing the behavior shipped in Tasks 1–5.

- [ ] **Step 1: Read the current guide**

Run: `cat docs/guides/managing-memories.md` (or open it) to find where `query_memories`/`add_memory` are already documented, so the new section sits next to them and matches the existing tone/heading level.

- [ ] **Step 2: Add a section**

Add a section (heading level matching the surrounding document, typically `##`) titled something like "Searching run history" with this content, adjusted to match the guide's existing voice:

```markdown
## Searching run history

`query_memories` searches curated, agent-written long-term memory. `search_history`
searches a different thing: the actual outcomes of past planner/worker/reviewer/
librarian calls — "did we already try fixing this" or "what did the reviewer say
about this file last time."

Only terminal calls (finished or failed) are searchable, and only their task and
output/error text — not their full tool-call trajectory. Available to
`communicator`, `planner`, and `librarian`.

```
search_history(query?, { role?, workstreamId?, status?: "done" | "failed", limit? })
```

An empty query returns the most recent runs. Filter by `role` (e.g. `"worker"`),
`workstreamId`, or `status` to narrow the search.
```

- [ ] **Step 3: Commit**

```bash
git add docs/guides/managing-memories.md
git commit -m "docs: document search_history alongside query_memories"
```

---

## Self-Review (spec coverage)

| Spec section | Task |
|---|---|
| Architecture (index location, write/read flow) | Task 2, Task 3 |
| Data model (`RunIndexEntry`, excerpting) | Task 1 |
| Ranking (`rankRuns`, Fuse weights/threshold) | Task 1 |
| Index maintenance (hook into `saveRun`, terminal-only) | Task 2 |
| Self-healing (rebuild on corrupt/missing index, no drift-count needed) | Task 2 |
| `search_history` tool interface & output format | Task 4 |
| Role access (communicator/planner/librarian only) | Task 5 |
| Error handling (no history, invalid filters → empty, not error) | Task 3, Task 4 |
| Testing plan | Tasks 1–5 each include their own tests per the spec's Testing section |

All spec sections have a task. No placeholders remain — every step has real code, real assertions, and real commands.
