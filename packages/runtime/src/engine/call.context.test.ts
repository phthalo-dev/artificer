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
import { loadContextSections } from './context-sections.js';
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

test('changing one finding updates only findings in the footer and snapshot', async () => {
  const { dataDir, config, store, ws, workspaceDir, run } = await setup();
  try {
    await store.createFinding({
      workstreamId: ws.id,
      role: 'planner',
      note: 'root cause is a missing sort',
      file: 'src/engine/call.ts',
    });
    await buildContext(store, run, workspaceDir, config, 'worker');
    const before = loadContextSections(
      store.layout.contextSectionsFile(ws.id),
    );

    await store.createFinding({
      workstreamId: ws.id,
      role: 'worker',
      note: 'sort by id as a tie-break',
    });
    const second = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'worker',
    );

    assert.match(second, /\[context sections updated: findings\]/);
    const after = loadContextSections(store.layout.contextSectionsFile(ws.id));
    assert.notEqual(after.sections.findings?.body, before.sections.findings?.body);
    for (const id of [
      'recent_tasks',
      'git_status',
      'prior_runs',
      'file_cache',
      'memory_signpost',
    ] as const) {
      assert.equal(after.sections[id]?.body, before.sections[id]?.body);
    }
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('empty omitted sections are not listed in the updated footer', async () => {
  const { dataDir, config, store, workspaceDir, run } = await setup();
  try {
    const first = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'worker',
    );
    assert.match(first, /\[context sections updated: memory_signpost\]/);
    assert.doesNotMatch(
      first,
      /\[context sections updated:[^\]]*findings/,
    );
    assert.doesNotMatch(
      first,
      /\[context sections updated:[^\]]*git_status/,
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('reviewer git_status_diff does not clobber worker git_status', async () => {
  const { dataDir, config, store, ws, workspaceDir, run } = await setup();
  try {
    await exec('git', ['-C', workspaceDir, 'init', '-q']);
    await exec('git', ['-C', workspaceDir, 'config', 'user.email', 't@t.test']);
    await exec('git', ['-C', workspaceDir, 'config', 'user.name', 'Test']);
    await fs.writeFile(path.join(workspaceDir, 'a.txt'), 'one\n');
    await exec('git', ['-C', workspaceDir, 'add', '-A']);
    await exec('git', ['-C', workspaceDir, 'commit', '-q', '-m', 'init']);
    await fs.writeFile(path.join(workspaceDir, 'a.txt'), 'changed\n');

    await buildContext(store, run, workspaceDir, config, 'worker');
    const afterWorker = loadContextSections(
      store.layout.contextSectionsFile(ws.id),
    );
    assert.ok(afterWorker.sections.git_status?.body);
    assert.equal(afterWorker.sections.git_status_diff, undefined);
    assert.doesNotMatch(
      afterWorker.sections.git_status.body,
      /Current diff \(git diff HEAD\)/,
    );

    const reviewer = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'reviewer',
    );
    assert.match(reviewer, /Current diff \(git diff HEAD\)/);
    const afterReviewer = loadContextSections(
      store.layout.contextSectionsFile(ws.id),
    );
    assert.equal(
      afterReviewer.sections.git_status?.body,
      afterWorker.sections.git_status?.body,
    );
    assert.match(
      afterReviewer.sections.git_status_diff?.body ?? '',
      /Current diff \(git diff HEAD\)/,
    );

    const workerAgain = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      'worker',
    );
    const footer = workerAgain.match(/\[context sections[^\]]*\]$/)?.[0];
    assert.ok(footer);
    assert.doesNotMatch(footer, /git_status/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
