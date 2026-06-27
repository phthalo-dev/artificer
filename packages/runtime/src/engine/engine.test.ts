import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Store } from '../storage/store.js';
import { Engine } from './engine.js';
import { MAX_FAILED_RUNS } from './workstream-machine.js';

async function buildEngine() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-engine-'));
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  return { engine: new Engine(config, store), store };
}

test('resumeInterruptedWorkstreams advances the FSM instead of spawning an LLM orchestrator', async () => {
  const { engine, store } = await buildEngine();

  const ws = await store.createWorkstream({
    title: 'test workstream',
    goal: 'do the thing',
    status: 'planning',
  });

  // MAX_FAILED_RUNS consecutive failed planner runs -- the last one is the
  // "recovered" zombie run from a crashed runtime.
  const runs = [];
  for (let i = 0; i < MAX_FAILED_RUNS; i += 1) {
    const run = await store.createRun({
      role: 'planner',
      task: 'plan',
      workstreamId: ws.id,
      model: 'test-model',
      status: 'failed',
    });
    runs.push(run);
  }

  const resumed = await engine.resumeInterruptedWorkstreams([
    runs[runs.length - 1],
  ]);
  assert.equal(resumed, 1);

  // The FSM sees MAX_FAILED_RUNS consecutive failures and blocks the
  // workstream directly -- no LLM call needed to reach that decision.
  const updated = await store.getWorkstream(ws.id);
  assert.equal(updated?.status, 'blocked');

  const allRuns = await store.listRunsForWorkstream(ws.id);
  assert.ok(
    !allRuns.some((r) => r.role === 'orchestrator'),
    'should not spawn an orchestrator run',
  );
});
