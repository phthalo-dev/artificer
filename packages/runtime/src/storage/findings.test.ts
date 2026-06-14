import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from './store.js';

async function freshStore(): Promise<Store> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-findings-'));
  const store = new Store(dir);
  await store.init();
  return store;
}

test('createFinding and listFindings round-trip per workstream', async () => {
  const store = await freshStore();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });

  await store.createFinding({
    workstreamId: ws.id,
    role: 'planner',
    note: 'root cause: MaxRetryError wraps the timeout in adapters.py',
    file: 'requests/adapters.py',
  });
  await store.createFinding({
    workstreamId: ws.id,
    role: 'worker',
    note: 'tests run with `python -m pytest -q`',
  });

  const findings = await store.listFindings(ws.id);
  assert.equal(findings.length, 2);
  assert.ok(
    findings.some((f) => f.role === 'planner' && f.file === 'requests/adapters.py'),
  );
  assert.ok(findings.every((f) => f.id && f.createdAt));
});

test('listFindings is empty for a workstream with none', async () => {
  const store = await freshStore();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  assert.deepEqual(await store.listFindings(ws.id), []);
});

test('findings are scoped to their workstream', async () => {
  const store = await freshStore();
  const a = await store.createWorkstream({ title: 'a', goal: 'g' });
  const b = await store.createWorkstream({ title: 'b', goal: 'g' });
  await store.createFinding({ workstreamId: a.id, role: 'planner', note: 'a-note' });
  assert.equal((await store.listFindings(a.id)).length, 1);
  assert.equal((await store.listFindings(b.id)).length, 0);
});
