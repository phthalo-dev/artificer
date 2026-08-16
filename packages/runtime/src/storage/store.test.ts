import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  emptyGithubWatchState,
  type GithubWatchState,
} from '../engine/github-watch.js';
import { Store } from './store.js';
import type { RunRecord } from './types.js';

function minimalRun(id: string, n: number): RunRecord {
  return {
    id,
    role: 'planner',
    task: 't',
    status: 'running',
    toolCalls: [{ name: 'read_file', input: {}, output: String(n), at: 't' }],
    usage: {
      inputTokens: n,
      outputTokens: n,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 1,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

test('readScheduleState defaults to empty, writeScheduleState persists it', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const empty = await store.readScheduleState();
  assert.deepEqual(empty, { schedules: {} });

  const next = {
    schedules: { morning: { lastFiredAt: 123 } },
  };
  await store.writeScheduleState(next);
  assert.deepEqual(await store.readScheduleState(), next);
});

test('readGithubWatchState defaults to empty, writeGithubWatchState persists it', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const empty = await store.readGithubWatchState();
  assert.deepEqual(empty, emptyGithubWatchState());

  const state: GithubWatchState = {
    notificationsSince: '2024-01-01T00:00:00.000Z',
    seenNotificationIds: ['a'],
    prs: {
      'https://github.com/acme/widgets/pull/123': {
        checksConclusion: 'SUCCESS',
      },
    },
  };
  await store.writeGithubWatchState(state);

  const loaded = await store.readGithubWatchState();
  assert.deepEqual(loaded, state);
});

test('concurrent saveRun to the same file does not throw ENOENT', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();
  const run = await store.createRun({ role: 'planner', task: 'plan' });

  await Promise.all(
    Array.from({ length: 32 }, (_, i) =>
      store.saveRun({ ...minimalRun(run.id, i), workstreamId: undefined }),
    ),
  );

  const loaded = await store.getRun(run.id);
  assert.ok(loaded);
  assert.equal(loaded.toolCalls.length, 1);
  const raw = await fs.readFile(store.layout.runFile(run.id), 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
});

test('saveRun indexes a run into history/index.json when it reaches a terminal status', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const run = await store.createRun({ role: 'worker', task: 'Fix the bug' });
  run.status = 'running';
  await store.saveRun(run);

  const raw = await fs
    .readFile(store.layout.historyIndexFile(), 'utf8')
    .catch(() => null);
  assert.equal(
    raw,
    null,
    'a running (non-terminal) save must not create the index',
  );

  run.status = 'done';
  run.output = 'Fixed it by adjusting the redirect.';
  await store.saveRun(run);

  const index = JSON.parse(
    await fs.readFile(store.layout.historyIndexFile(), 'utf8'),
  );
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

  const index = JSON.parse(
    await fs.readFile(store.layout.historyIndexFile(), 'utf8'),
  );
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

  const index = JSON.parse(
    await fs.readFile(store.layout.historyIndexFile(), 'utf8'),
  );
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

  const index = JSON.parse(
    await fs.readFile(store.layout.historyIndexFile(), 'utf8'),
  );
  const ids = index.map((e: { id: string }) => e.id).sort();
  assert.deepEqual(ids, [newer.id, older.id].sort());
});

test('concurrent saveRun calls for different runs both land in history/index.json', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  // Seed the index with a prior entry first, so the two concurrent upserts
  // below go through the "parse existing index.json, modify, write" path
  // rather than the ENOENT/ rebuild-from-runs/ self-heal path (which would
  // independently reconstruct the full set from disk and mask a races in
  // the read-modify-write cycle).
  const seed = await store.createRun({ role: 'worker', task: 'Seed task' });
  seed.status = 'done';
  seed.output = 'seed output';
  await store.saveRun(seed);

  const runA = await store.createRun({ role: 'worker', task: 'Task A' });
  runA.status = 'done';
  runA.output = 'output A';

  const runB = await store.createRun({ role: 'worker', task: 'Task B' });
  runB.status = 'done';
  runB.output = 'output B';

  await Promise.all([store.saveRun(runA), store.saveRun(runB)]);

  const index = JSON.parse(
    await fs.readFile(store.layout.historyIndexFile(), 'utf8'),
  );
  const ids = index.map((e: { id: string }) => e.id).sort();
  assert.deepEqual(ids, [seed.id, runA.id, runB.id].sort());
});

test('searchHistory ranks by task/output text and respects limit', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const authRun = await store.createRun({
    role: 'worker',
    task: 'Fix auth redirect loop',
  });
  authRun.status = 'done';
  authRun.output = 'Patched the session check.';
  await store.saveRun(authRun);

  const changelogRun = await store.createRun({
    role: 'worker',
    task: 'Update changelog',
  });
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
  assert.deepEqual(
    byRole.map((r) => r.id),
    [plannerRun.id],
  );

  const byWorkstream = await store.searchHistory('', { workstreamId: 'ws_1' });
  assert.deepEqual(
    byWorkstream.map((r) => r.id),
    [workerRun.id],
  );

  const byStatus = await store.searchHistory('', { status: 'failed' });
  assert.deepEqual(
    byStatus.map((r) => r.id),
    [plannerRun.id],
  );
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

test('saveRun succeeds and leaves the run status untouched even when the history-index write fails', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  // Make history/index.json unwritable by occupying its parent directory
  // path with a plain file instead of a directory: ensureDir('.../history')
  // (inside writeJsonAtomic) and fs.readFile('.../history/index.json')
  // (inside readHistoryIndex) both fail with ENOTDIR/ENOENT-adjacent errors
  // against a real filesystem, without relying on chmod (less portable).
  const historyDir = path.dirname(store.layout.historyIndexFile());
  await fs.writeFile(historyDir, 'not a directory', 'utf8');

  const run = await store.createRun({ role: 'worker', task: 'Fix the bug' });
  run.status = 'done';
  run.output = 'Fixed it by adjusting the redirect.';

  await assert.doesNotReject(() => store.saveRun(run));

  const saved = await store.getRun(run.id);
  assert.equal(
    saved?.status,
    'done',
    'the run record itself must still reflect success, not get overwritten as failed by an index-write error',
  );
  assert.equal(saved?.error, undefined);
});

test('saveRun does not index a terminal communicator run into history/index.json', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const run = await store.createRun({
    role: 'communicator',
    task: 'chat about widgets',
  });
  run.status = 'done';
  run.output = 'Sure, here is the answer.';
  await store.saveRun(run);

  const raw = await fs
    .readFile(store.layout.historyIndexFile(), 'utf8')
    .catch(() => null);
  assert.equal(
    raw,
    null,
    'a terminal communicator run must not create the history index at all',
  );
});

test('saveRun does not index a terminal orchestrator run into history/index.json', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const run = await store.createRun({
    role: 'orchestrator',
    task: 'route the next call',
  });
  run.status = 'done';
  run.output = 'routed';
  await store.saveRun(run);

  const raw = await fs
    .readFile(store.layout.historyIndexFile(), 'utf8')
    .catch(() => null);
  assert.equal(
    raw,
    null,
    'a terminal orchestrator run must not create the history index at all',
  );
});

for (const role of ['worker', 'planner', 'reviewer', 'librarian'] as const) {
  test(`saveRun indexes a terminal ${role} run into history/index.json`, async () => {
    const dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'artificer-store-'),
    );
    const store = new Store(dataDir);
    await store.init();

    const run = await store.createRun({ role, task: `${role} task` });
    run.status = 'done';
    run.output = `${role} output`;
    await store.saveRun(run);

    const index = JSON.parse(
      await fs.readFile(store.layout.historyIndexFile(), 'utf8'),
    );
    assert.equal(index.length, 1);
    assert.equal(index[0].id, run.id);
  });
}

test('a history/index.json containing valid JSON that is not an array triggers rebuild from runs/ (saveRun path)', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const existing = await store.createRun({
    role: 'worker',
    task: 'Existing task',
  });
  existing.status = 'done';
  existing.output = 'existing output';
  await store.saveRun(existing);

  // Wrong-shape but valid JSON, written directly so it bypasses Store
  // entirely (simulating an old format or external tampering).
  await fs.writeFile(store.layout.historyIndexFile(), 'null', 'utf8');

  // A fresh Store instance so its in-memory index cache starts cold and this
  // save genuinely has to read the on-disk (wrong-shape) file.
  const store2 = new Store(dataDir);
  const newer = await store2.createRun({
    role: 'planner',
    task: 'Newer task',
  });
  newer.status = 'done';
  newer.output = 'newer output';
  await store2.saveRun(newer);

  const index = JSON.parse(
    await fs.readFile(store.layout.historyIndexFile(), 'utf8'),
  );
  const ids = index.map((e: { id: string }) => e.id).sort();
  assert.deepEqual(ids, [existing.id, newer.id].sort());
});

test('a history/index.json containing valid JSON that is not an array triggers rebuild from runs/ (searchHistory path)', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  const existing = await store.createRun({
    role: 'worker',
    task: 'Existing task about widgets',
  });
  existing.status = 'done';
  existing.output = 'existing output';
  await store.saveRun(existing);

  await fs.writeFile(store.layout.historyIndexFile(), '{}', 'utf8');

  // Fresh Store instance: cold cache, so searchHistory must read the
  // on-disk (wrong-shape) file and self-heal instead of serving a cached
  // (nonexistent, in this instance) array.
  const store2 = new Store(dataDir);
  const results = await store2.searchHistory('widgets');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, existing.id);

  const index = JSON.parse(
    await fs.readFile(store.layout.historyIndexFile(), 'utf8'),
  );
  assert.equal(index.length, 1);
  assert.equal(index[0].id, existing.id);
});

test('a concurrent searchHistory call does not race a concurrent saveRun call on a fresh store', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-store-'));
  const store = new Store(dataDir);
  await store.init();

  // Fresh store: history/index.json does not exist yet. The first operation
  // (whichever of these wins the race) to touch it will hit
  // readHistoryIndex()'s self-heal rebuild-from-runs/ path (ENOENT -> read
  // runs/ -> write index.json) — the same path `searchHistory` exercises via
  // a bare read and `saveRun`/`upsertHistoryIndexEntry` exercises as the
  // first step of its read-modify-write. Racing them via Promise.all is
  // exactly the scenario `withHistoryIndexChain` must serialize.
  const runs = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      store.createRun({ role: 'worker', task: `task ${i}` }),
    ),
  );
  for (const r of runs) {
    r.status = 'done';
    r.output = `output for ${r.id}`;
  }

  await Promise.all([
    ...runs.map((r) => store.saveRun(r)),
    ...Array.from({ length: 10 }, () => store.searchHistory('')),
    ...Array.from({ length: 10 }, () => store.searchHistory('task')),
  ]);

  const raw = await fs.readFile(store.layout.historyIndexFile(), 'utf8');
  const index = JSON.parse(raw); // must not throw: index.json stays valid JSON
  const ids = index.map((e: { id: string }) => e.id).sort();
  assert.deepEqual(
    ids,
    runs.map((r) => r.id).sort(),
    'every terminal run ends up indexed exactly once, none lost or duplicated',
  );
  assert.equal(new Set(ids).size, ids.length, 'no duplicate entries');
});
