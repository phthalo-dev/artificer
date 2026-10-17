import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Store } from '../storage/store.js';
import { Engine, turnErrorReply } from './engine.js';

async function buildEngine() {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-conversation-recovery-'),
  );
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  return { engine: new Engine(config, store), store };
}

test('a cancelled turn error is not a chat reply', () => {
  assert.equal(turnErrorReply(new Error('cancelled')), undefined);
  assert.equal(turnErrorReply(new Error('claude missing')), 'claude missing');
});

test('startup promotes a pending conversation that already has a worktree', async () => {
  const { engine, store } = await buildEngine();
  const ws = await store.createWorkstream({
    title: 'chat',
    goal: 'talk',
    driver: 'conversation',
    status: 'pending',
  });
  const repo = path.join(store.layout.workstreamWorkspace(ws.id), 'repo');
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, '.git'), 'gitdir: /tmp/shared.git\n');
  await engine.recoverPendingConversations();
  assert.equal((await store.getWorkstream(ws.id))?.status, 'in_progress');
});

test('startup deletes a pending conversation with no worktree', async () => {
  const { engine, store } = await buildEngine();
  const ws = await store.createWorkstream({
    title: 'chat',
    goal: 'talk',
    driver: 'conversation',
    status: 'pending',
  });
  await engine.recoverPendingConversations();
  assert.equal(await store.getWorkstream(ws.id), null);
});

test('startup replies once for an interrupted conversation run', async () => {
  const { engine, store } = await buildEngine();
  const ws = await store.createWorkstream({
    title: 'chat',
    goal: 'talk',
    driver: 'conversation',
    status: 'in_progress',
  });
  await store.createRun({
    role: 'worker',
    task: 'hello',
    workstreamId: ws.id,
    status: 'running',
  });

  await engine.recoverZombieRuns();
  await engine.recoverZombieRuns();

  const messages = (await store.listMessages()).filter(
    (message) => message.workstreamId === ws.id,
  );
  assert.deepEqual(
    messages.map((message) => message.content),
    ['Interrupted by a runtime restart (zombie run).'],
  );
  assert.equal((await store.listRunsForWorkstream(ws.id)).length, 1);
});
