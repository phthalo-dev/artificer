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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-orchtool-'));
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

test('add_memory accepts kind "preference" and stores it as given', async () => {
  const store = await freshStore();
  const run = await store.createRun({ role: 'communicator', task: 'chat' });
  const tools = createOrchestratorTools(ctxFor(store, run));
  const addMemory = tools.find((t) => t.name === 'add_memory');
  assert.ok(addMemory, 'add_memory tool is present');

  await addMemory.handler({
    content: 'Always run tests before committing.',
    kind: 'preference',
    tags: ['preference'],
  });

  const memories = await store.listMemories();
  assert.equal(memories.length, 1);
  assert.equal(memories[0].kind, 'preference');
});
