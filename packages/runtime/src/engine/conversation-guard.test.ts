import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Store } from '../storage/store.js';
import { shouldStepWorkstream } from './conversation-guard.js';
import { Engine } from './engine.js';

async function buildEngine() {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-conversation-guard-'),
  );
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  const engine = new Engine(config, store);
  return { engine, store };
}

test('conversation workstreams are not stepped', () => {
  assert.equal(shouldStepWorkstream('conversation'), false);
  assert.equal(shouldStepWorkstream('machine'), true);
  assert.equal(shouldStepWorkstream(undefined), true);
});

test('resumeInterruptedWorkstreams does not add a run for a conversation', async () => {
  const { engine, store } = await buildEngine();
  const ws = await store.createWorkstream({
    title: 'chat',
    goal: 'talk',
    driver: 'conversation',
    status: 'in_progress',
  });
  const run = await store.createRun({
    role: 'worker',
    task: 'hello',
    workstreamId: ws.id,
    status: 'failed',
  });
  run.error = 'Interrupted by a runtime restart (zombie run).';
  await store.saveRun(run);
  const resumed = await engine.resumeInterruptedWorkstreams([run]);
  assert.equal(resumed, 1);
  const runs = await store.listRunsForWorkstream(ws.id);
  assert.equal(runs.length, 1);
});
