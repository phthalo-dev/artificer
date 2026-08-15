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
