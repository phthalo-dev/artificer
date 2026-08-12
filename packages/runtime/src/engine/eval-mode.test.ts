import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import type { ToolContext } from '../context.js';
import { IdentityGitSync } from '../storage/identity-git-sync.js';
import { IdentityStore } from '../storage/identity-store.js';
import { Store } from '../storage/store.js';
import { createCommunicatorTools } from '../tools/communication.js';
import { createOrchestratorTools } from '../tools/orchestrator-tool.js';
import { Engine } from './engine.js';
import { WorkstreamMemoryService } from './workstream-memory.js';

const exec = promisify(execFile);

async function buildTestContext() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-eval-'));
  const execDir = path.join(rootDir, 'exec');
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: execDir,
    ARTIFICER_IDENTITY_DIR: rootDir,
    LLM_API_KEY: 'test-key-not-used',
    RUNTIME_EVAL_MODE: 'true',
    PORT: '0',
  });
  const store = new Store(execDir);
  await store.init();
  const identity = new IdentityStore(rootDir);
  await identity.init();
  const engine = new Engine(config, store, undefined, undefined, identity);
  const run = await store.createRun({ role: 'communicator', task: 'chat' });
  const ctx: ToolContext = {
    engine,
    run,
    workspaceDir: execDir,
  };
  return { rootDir, config, store, identity, engine, ctx };
}

test('learn tool returns an error without spawning in eval mode', async () => {
  const { ctx, store } = await buildTestContext();
  const learn = createCommunicatorTools(ctx).find(
    (tool) => tool.name === 'learn',
  );
  assert.ok(learn);

  const result = await learn.handler({ material: 'Remember this fact.' });

  assert.match(String(result), /eval mode/i);
  assert.equal((await store.listRuns()).length, 1);
});

test('add_memory returns an error without writing in eval mode', async () => {
  const { ctx, identity } = await buildTestContext();
  const addMemory = createOrchestratorTools(ctx).find(
    (tool) => tool.name === 'add_memory',
  );
  assert.ok(addMemory);

  const result = await addMemory.handler({ content: 'Do not save this.' });

  assert.match(String(result), /eval mode/i);
  assert.deepEqual(await identity.listMemories(), []);
});

test('WorkstreamMemoryService leaves identity unchanged in eval mode', async () => {
  const { store, identity } = await buildTestContext();
  const service = new WorkstreamMemoryService(identity, store, true);
  const workstream = await store.createWorkstream({
    title: 'Eval workstream',
    goal: 'Exercise terminal memory handling',
    status: 'done',
    summary: 'Finished.',
  });

  await service.onCreated(workstream);
  await service.onTerminal(workstream);
  const distill = await service.requestDistill(workstream, async () => ({
    runId: 'must-not-spawn',
  }));

  assert.deepEqual(await identity.listMemories(), []);
  assert.equal(distill, null);
});

test('IdentityGitSync commit and pull operations are no-ops in eval mode', async () => {
  const { rootDir } = await buildTestContext();
  await exec('git', ['-C', rootDir, 'init']);
  await exec('git', ['-C', rootDir, 'config', 'user.email', 'test@test.com']);
  await exec('git', ['-C', rootDir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(rootDir, '.gitkeep'), '');
  await exec('git', ['-C', rootDir, 'add', '.gitkeep']);
  await exec('git', ['-C', rootDir, 'commit', '-m', 'init']);

  const identity = new IdentityStore(rootDir);
  await identity.init();
  await identity.addMemory({
    content: 'Uncommitted eval memory',
    tags: [],
    kind: 'note',
  });
  const sync = new IdentityGitSync(
    rootDir,
    { autoCommit: true, autoPush: false },
    undefined,
    true,
  );
  await sync.init();
  const { stdout: before } = await exec('git', [
    '-C',
    rootDir,
    'rev-parse',
    'HEAD',
  ]);

  await sync.commitPaths('eval memory', ['identity/']);
  const pullResult = await sync.pullFromRemote();

  const { stdout: after } = await exec('git', [
    '-C',
    rootDir,
    'rev-parse',
    'HEAD',
  ]);
  assert.equal(after.trim(), before.trim());
  assert.equal(pullResult, 'unchanged');
});

test('Engine.persistConfig leaves identity config unchanged in eval mode', async () => {
  const { rootDir, engine } = await buildTestContext();
  const configPath = path.join(rootDir, 'artificer.config.json');
  const original = '{"preset":"quality-first"}\n';
  await fs.writeFile(configPath, original);

  await engine.persistConfig();

  assert.equal(await fs.readFile(configPath, 'utf-8'), original);
});
