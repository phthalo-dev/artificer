import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
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
