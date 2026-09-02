import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';
import { Store } from '../storage/store.js';
import { buildContext } from './call.js';
import { FileCache } from './file-cache.js';

const exec = promisify(execFile);

function stripFooter(text: string): string {
  return text.replace(/\n\n\[context sections[^\]]*\]$/, '');
}

async function setup() {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-call-context-'),
  );
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  const ws = await store.createWorkstream({
    title: 'context diffs',
    goal: 'keep prompts cache-stable',
    status: 'in_progress',
  });
  const workspaceDir = store.layout.workstreamWorkspace(ws.id);
  await fs.mkdir(workspaceDir, { recursive: true });
  const run = await store.createRun({
    role: 'worker',
    task: 'implement the feature',
    workstreamId: ws.id,
    model: 'test-model',
  });
  return { dataDir, config, store, ws, workspaceDir, run };
}

test('two buildContext calls with unchanged fixtures replay identical sections', async () => {
  const { dataDir, config, store, ws, workspaceDir, run } = await setup();
  try {
    await store.createFinding({
      workstreamId: ws.id,
      role: 'planner',
      note: 'root cause is a missing sort',
      file: 'src/engine/call.ts',
    });
    await store.createTask({
      workstreamId: ws.id,
      role: 'worker',
      description: 'add hashing',
    });
    const done = await store.createTask({
      workstreamId: ws.id,
      role: 'worker',
      description: 'write tests',
    });
    await store.updateTask(ws.id, done.id, {
      status: 'done',
      result: 'tests added',
    });
    const cache = await FileCache.load(store.layout, ws.id, 8);
    cache.recordRead(
      'src/engine/call.ts',
      1,
      'export async function buildContext',
    );
    await cache.save();

    const first = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'worker',
    );
    const second = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'worker',
    );

    assert.match(first, /\[context sections updated:/);
    assert.match(second, /\[context sections: all unchanged\]/);
    assert.equal(stripFooter(first), stripFooter(second));
    assert.match(first, /root cause is a missing sort/);
    assert.match(first, /write tests/);
    assert.match(first, /Recently read files:/);

    const snapshot = await fs.readFile(
      store.layout.contextSectionsFile(ws.id),
      'utf8',
    );
    assert.match(snapshot, /"version": 1/);
    assert.match(snapshot, /"findings"/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('no workstreamId skips context-sections file IO', async () => {
  const { dataDir, config, store } = await setup();
  try {
    const run = await store.createRun({
      role: 'communicator',
      task: 'say hello',
    });
    const text = await buildContext(
      store,
      run,
      store.layout.workspaceDir,
      config,
      'communicator',
    );
    assert.doesNotMatch(text, /\[context sections/);
    const entries = await fs.readdir(store.layout.workstreamsDir);
    for (const id of entries) {
      await assert.rejects(
        fs.access(store.layout.contextSectionsFile(id)),
        (err: NodeJS.ErrnoException) => err.code === 'ENOENT',
      );
    }
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('non-work roles with a workstreamId skip context-sections file IO', async () => {
  const { dataDir, config, store, ws, workspaceDir } = await setup();
  try {
    const run = await store.createRun({
      role: 'communicator',
      task: 'status update',
      workstreamId: ws.id,
    });
    const text = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'communicator',
    );
    assert.doesNotMatch(text, /\[context sections/);
    await assert.rejects(
      fs.access(store.layout.contextSectionsFile(ws.id)),
      (err: NodeJS.ErrnoException) => err.code === 'ENOENT',
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('git status fixture is byte-identical across buildContext calls', async () => {
  const { dataDir, config, store, workspaceDir, run } = await setup();
  try {
    await exec('git', ['-C', workspaceDir, 'init', '-q']);
    await exec('git', ['-C', workspaceDir, 'config', 'user.email', 't@t.test']);
    await exec('git', ['-C', workspaceDir, 'config', 'user.name', 'Test']);
    await fs.writeFile(path.join(workspaceDir, 'z.txt'), 'z\n');
    await fs.writeFile(path.join(workspaceDir, 'a.txt'), 'a\n');
    await fs.writeFile(path.join(workspaceDir, 'm.txt'), 'm\n');

    const first = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'worker',
    );
    const second = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'worker',
    );
    assert.match(first, /Files changed so far/);
    assert.equal(stripFooter(first), stripFooter(second));
    const gitBlock = first.match(
      /Files changed so far \(git status --short, in [^)]+\):\n([\s\S]*?)\n\n/,
    );
    assert.ok(gitBlock);
    const lines = gitBlock![1].split('\n');
    const sorted = [...lines].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(lines, sorted);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
