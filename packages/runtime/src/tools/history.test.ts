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
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-historytool-'),
  );
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

  const callerRun = await store.createRun({
    role: 'communicator',
    task: 'chat',
  });
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

test('search_history formats a run with an empty outputExcerpt without a dangling second line', async () => {
  const store = await freshStore();
  const run = await store.createRun({
    role: 'worker',
    task: 'Task with no output',
  });
  run.status = 'done';
  // No output and no error set -> outputExcerpt is ''.
  await store.saveRun(run);

  const callerRun = await store.createRun({
    role: 'communicator',
    task: 'chat',
  });
  const tools = createHistoryTools(ctxFor(store, callerRun));
  const searchHistory = tools.find((t) => t.name === 'search_history');
  assert.ok(searchHistory);

  const result = await searchHistory.handler({ query: 'no output' });
  assert.equal(result, '- [worker] Task with no output (done)');
});

test('search_history passes role/workstreamId/status/limit filters through to the store', async () => {
  const store = await freshStore();
  const done = await store.createRun({ role: 'worker', task: 'same text' });
  done.status = 'done';
  await store.saveRun(done);

  const failed = await store.createRun({ role: 'worker', task: 'same text' });
  failed.status = 'failed';
  await store.saveRun(failed);

  const callerRun = await store.createRun({
    role: 'communicator',
    task: 'chat',
  });
  const tools = createHistoryTools(ctxFor(store, callerRun));
  const searchHistory = tools.find((t) => t.name === 'search_history');
  assert.ok(searchHistory);

  const result = await searchHistory.handler({ status: 'failed' });
  assert.match(result, /\(failed\)/);
  assert.doesNotMatch(result, /\(done\)/);
});
