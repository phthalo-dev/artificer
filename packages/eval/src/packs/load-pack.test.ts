import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { SweBenchInstance } from '../bench/types.js';
import { getEvalPack, listEvalPacks } from './registry.js';
import { loadEvalPack, sweBenchInstanceToEvalTask } from './load-pack.js';
import {
  SWE_BENCH_LITE_30,
  SWE_BENCH_LITE_30_PACK_ID,
} from './swebench-lite-30.js';

test('listEvalPacks includes swebench-lite-30 with 30 instance ids', () => {
  const packs = listEvalPacks();
  assert.equal(
    packs.some((pack) => pack.id === SWE_BENCH_LITE_30_PACK_ID),
    true,
  );
  assert.equal(SWE_BENCH_LITE_30.instanceIds.length, 30);
  assert.ok(SWE_BENCH_LITE_30.instanceIds.includes('pallets__flask-4045'));
});

test('getEvalPack rejects unknown ids', () => {
  assert.throws(() => getEvalPack('not-a-pack'), /Unknown eval pack/);
});

test('sweBenchInstanceToEvalTask builds a repo-patch swebench task', () => {
  const instance: SweBenchInstance = {
    instance_id: 'pallets__flask-4045',
    repo: 'pallets/flask',
    base_commit: 'abc123',
    problem_statement: 'Fix the bug.',
    suite: 'swebench',
  };
  const task = sweBenchInstanceToEvalTask(instance);
  assert.equal(task.manifest.kind, 'repo-patch');
  assert.deepEqual(task.manifest.grade, { type: 'swebench' });
  assert.equal(task.manifest.repo?.url, 'https://github.com/pallets/flask.git');
  assert.equal(task.manifest.repo?.baseCommit, 'abc123');
  assert.match(task.prompt, /Fix the bug/);
});

test('loadEvalPack filters instances and honors limit', async () => {
  const packed = await loadEvalPack({
    packId: SWE_BENCH_LITE_30_PACK_ID,
    limit: 2,
    loadInstances: async (_dataset, _split, _config, ids) =>
      ids.map((id) => ({
        instance_id: id,
        repo: 'pallets/flask',
        base_commit: 'deadbeef',
        problem_statement: `Issue ${id}`,
        suite: 'swebench' as const,
      })),
  });
  assert.equal(packed.tasks.length, 2);
  assert.deepEqual(
    packed.tasks.map((task) => task.manifest.id),
    SWE_BENCH_LITE_30.instanceIds.slice(0, 2),
  );
  assert.equal(packed.pack.id, SWE_BENCH_LITE_30_PACK_ID);
});
