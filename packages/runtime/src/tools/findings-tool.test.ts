import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ToolContext } from '../context.js';
import { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';
import { createOrchestratorTools } from './orchestrator-tool.js';

async function freshStore(): Promise<Store> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-findtool-'));
  const store = new Store(dir);
  await store.init();
  return store;
}

// Minimal context: record_finding only touches ctx.engine.store and ctx.run.
function ctxFor(store: Store, run: RunRecord): ToolContext {
  return {
    engine: { store } as unknown as ToolContext['engine'],
    run,
    workspaceDir: '/tmp',
  };
}

test('record_finding stores a finding tagged with the run role and workstream', async () => {
  const store = await freshStore();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  const run = await store.createRun({
    role: 'planner',
    task: 'plan it',
    workstreamId: ws.id,
  });

  const tools = createOrchestratorTools(ctxFor(store, run));
  const record = tools.find((t) => t.name === 'record_finding');
  assert.ok(record, 'record_finding tool is present');

  const out = await record.handler({
    note: 'root cause in a.py',
    file: 'a.py',
  });
  assert.match(out, /Recorded finding/);

  const findings = await store.listFindings(ws.id);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].role, 'planner');
  assert.equal(findings[0].file, 'a.py');
  assert.equal(findings[0].note, 'root cause in a.py');
});

test('record_finding refuses outside a workstream', async () => {
  const store = await freshStore();
  const run = await store.createRun({ role: 'communicator', task: 'chat' });
  const tools = createOrchestratorTools(ctxFor(store, run));
  const record = tools.find((t) => t.name === 'record_finding');
  const out = await record!.handler({ note: 'x' });
  assert.match(out, /only be recorded inside a workstream/i);
});
