import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CodemodeCellStore } from '../codemode/cells.js';
import { loadConfig } from '../config.js';
import type { EngineApi } from '../context.js';
import { Store } from '../storage/store.js';
import { executeCall } from './call.js';
import type { WorkerExecutor } from './executor.js';
import { RoleRegistry } from './role-registry.js';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-call-'));
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  const run = await store.createRun({ role: 'worker', task: 't' });
  const engine = {
    store,
    config,
    emit: () => {},
  } as unknown as EngineApi;
  return { dir, config, store, run, engine };
}

test('executeCall disposes the run cell store after a successful executor path', async (t) => {
  const { config, store, run, engine } = await fixture();
  const disposed: string[] = [];
  const orig = CodemodeCellStore.prototype.disposeRun;
  t.after(() => {
    CodemodeCellStore.prototype.disposeRun = orig;
  });
  CodemodeCellStore.prototype.disposeRun = function disposeRun(runId: string) {
    disposed.push(runId);
    return orig.call(this, runId);
  };

  const executor: WorkerExecutor = {
    name: 'test-executor',
    execute: async () => ({ text: 'ok' }),
  };

  const finished = await executeCall(run, {
    resolveModel: () => {
      throw new Error('model should not be used');
    },
    config,
    store,
    engine,
    executor,
    registry: new RoleRegistry(),
  });

  assert.equal(finished.status, 'done');
  assert.deepEqual(disposed, [run.id]);
});

test('executeCall disposes the run cell store after a failed executor path', async (t) => {
  const { config, store, run, engine } = await fixture();
  const disposed: string[] = [];
  const orig = CodemodeCellStore.prototype.disposeRun;
  t.after(() => {
    CodemodeCellStore.prototype.disposeRun = orig;
  });
  CodemodeCellStore.prototype.disposeRun = function disposeRun(runId: string) {
    disposed.push(runId);
    return orig.call(this, runId);
  };

  const executor: WorkerExecutor = {
    name: 'test-executor',
    execute: async () => {
      throw new Error('executor exploded');
    },
  };

  const finished = await executeCall(run, {
    resolveModel: () => {
      throw new Error('model should not be used');
    },
    config,
    store,
    engine,
    executor,
    registry: new RoleRegistry(),
  });

  assert.equal(finished.status, 'failed');
  assert.match(finished.error ?? '', /executor exploded/);
  assert.deepEqual(disposed, [run.id]);
});
