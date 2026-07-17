import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { IdentityGitSync } from './identity-git-sync.js';
import type { IdentityConfig } from '../api/types.js';

const exec = promisify(execFile);

async function gitLog(dir: string): Promise<string[]> {
  const { stdout } = await exec('git', [
    '-C',
    dir,
    'log',
    '--oneline',
    '--no-decorate',
  ]);
  return stdout.trim().split('\n').filter(Boolean);
}

async function initRepo(dir: string): Promise<void> {
  await exec('git', ['-C', dir, 'init']);
  await exec('git', ['-C', dir, 'config', 'user.email', 'test@test.com']);
  await exec('git', ['-C', dir, 'config', 'user.name', 'Test']);
  // Initial commit so the repo has a HEAD
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  await exec('git', ['-C', dir, 'add', '.']);
  await exec('git', ['-C', dir, 'commit', '-m', 'init']);
}

async function initBareRepo(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  await exec('git', ['init', '--bare', dir]);
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-gs-'));
}

describe('IdentityGitSync', () => {
  let rootDir: string;
  let syncConfig: IdentityConfig;

  beforeEach(async () => {
    rootDir = tmpDir();
    await initRepo(rootDir);
    syncConfig = { autoCommit: true, autoPush: false };
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('commits to git when a memory is added', async () => {
    const store = new IdentityGitSync(rootDir, syncConfig);
    await store.init();

    const memory = await store.addMemory({
      content: 'Remember this',
      tags: ['test'],
      kind: 'note',
    });

    const log = await gitLog(rootDir);
    assert.ok(
      log.some((l) => l.includes(memory.id)),
      `expected commit for ${memory.id}`,
    );
  });

  it('stages new schedule files with identity changes', async () => {
    const store = new IdentityGitSync(rootDir, syncConfig);
    await store.init();
    const scheduleDir = path.join(rootDir, 'agent', 'schedules');
    fs.mkdirSync(scheduleDir, { recursive: true });
    fs.writeFileSync(path.join(scheduleDir, 'daily.md'), '# Daily');

    await store.addMemory({ content: 'x', tags: [], kind: 'note' });

    const { stdout } = await exec('git', [
      '-C',
      rootDir,
      'show',
      '--format=',
      '--name-only',
      'HEAD',
    ]);
    assert.match(stdout, /agent\/schedules\/daily\.md/);
  });

  it('commit message uses "memory: add {id}" format', async () => {
    const store = new IdentityGitSync(rootDir, syncConfig);
    await store.init();

    const memory = await store.addMemory({
      content: 'x',
      tags: [],
      kind: 'note',
    });

    const log = await gitLog(rootDir);
    assert.ok(log.some((l) => l.includes(`memory: add ${memory.id}`)));
  });

  it('uses custom commitPrefix when set', async () => {
    const store = new IdentityGitSync(rootDir, {
      ...syncConfig,
      commitPrefix: 'chore:',
    });
    await store.init();

    const memory = await store.addMemory({
      content: 'x',
      tags: [],
      kind: 'note',
    });

    const log = await gitLog(rootDir);
    assert.ok(log.some((l) => l.includes(`chore: add ${memory.id}`)));
  });

  it('commits when a memory is updated', async () => {
    const store = new IdentityGitSync(rootDir, syncConfig);
    await store.init();

    const memory = await store.addMemory({
      content: 'before',
      tags: [],
      kind: 'note',
    });
    const before = await gitLog(rootDir);

    await store.updateMemory(memory.id, { content: 'after' });

    const after = await gitLog(rootDir);
    assert.ok(
      after.length > before.length,
      'expected a new commit after update',
    );
    assert.ok(after.some((l) => l.includes(`memory: update ${memory.id}`)));
  });

  it('commits when a memory is deleted', async () => {
    const store = new IdentityGitSync(rootDir, syncConfig);
    await store.init();

    const memory = await store.addMemory({
      content: 'to delete',
      tags: [],
      kind: 'note',
    });
    const before = await gitLog(rootDir);

    await store.deleteMemory(memory.id);

    const after = await gitLog(rootDir);
    assert.ok(after.length > before.length);
    assert.ok(after.some((l) => l.includes(`memory: delete ${memory.id}`)));
  });

  it('does not commit when autoCommit is false', async () => {
    const store = new IdentityGitSync(rootDir, { autoCommit: false });
    await store.init();

    await store.addMemory({ content: 'no commit', tags: [], kind: 'note' });

    const log = await gitLog(rootDir);
    // Only the initial "init" commit should exist
    assert.equal(log.length, 1);
  });

  it('pushes to remote when autoPush is true', async () => {
    const remoteDir = tmpDir();
    await initBareRepo(remoteDir);
    await exec('git', ['-C', rootDir, 'remote', 'add', 'origin', remoteDir]);

    const store = new IdentityGitSync(rootDir, {
      autoCommit: true,
      autoPush: true,
    });
    await store.init();

    await store.addMemory({ content: 'pushed', tags: [], kind: 'note' });

    // Verify the commit landed in the remote
    const { stdout } = await exec('git', ['-C', remoteDir, 'log', '--oneline']);
    assert.ok(
      stdout.includes('memory: add'),
      'expected pushed commit in remote',
    );

    fs.rmSync(remoteDir, { recursive: true, force: true });
  });

  it('does not throw when git commit fails (nothing to commit)', async () => {
    const store = new IdentityGitSync(rootDir, syncConfig);
    await store.init();

    // Call commitAndPush indirectly by adding a memory then immediately calling
    // update with the same content — second update may produce identical file
    const memory = await store.addMemory({
      content: 'same',
      tags: [],
      kind: 'note',
    });
    await assert.doesNotReject(() =>
      store.updateMemory(memory.id, { content: 'same' }),
    );
  });

  it('aborts the rebase and reports conflict when pull conflicts', async () => {
    const remoteDir = tmpDir();
    const otherDir = tmpDir();
    await initBareRepo(remoteDir);
    await exec('git', ['-C', rootDir, 'remote', 'add', 'origin', remoteDir]);
    await exec('git', ['-C', rootDir, 'push', '-u', 'origin', 'HEAD']);
    await exec('git', ['clone', remoteDir, otherDir]);
    await exec('git', [
      '-C',
      otherDir,
      'config',
      'user.email',
      'test@test.com',
    ]);
    await exec('git', ['-C', otherDir, 'config', 'user.name', 'Test']);

    fs.writeFileSync(path.join(rootDir, 'shared.txt'), 'local\n');
    await exec('git', ['-C', rootDir, 'add', 'shared.txt']);
    await exec('git', ['-C', rootDir, 'commit', '-m', 'local change']);

    fs.writeFileSync(path.join(otherDir, 'shared.txt'), 'remote\n');
    await exec('git', ['-C', otherDir, 'add', 'shared.txt']);
    await exec('git', ['-C', otherDir, 'commit', '-m', 'remote change']);
    await exec('git', ['-C', otherDir, 'push']);

    const store = new IdentityGitSync(rootDir, { autoCommit: false });
    assert.equal(await store.pullFromRemote(), 'conflict');
    const { stdout } = await exec('git', [
      '-C',
      rootDir,
      'status',
      '--porcelain',
    ]);
    assert.equal(stdout, '');

    fs.rmSync(remoteDir, { recursive: true, force: true });
    fs.rmSync(otherDir, { recursive: true, force: true });
  });

  it('still returns the memory even if git commit fails', async () => {
    // Use a non-git directory as rootDir to force git failure
    const nonGitDir = tmpDir();
    const store = new IdentityGitSync(nonGitDir, syncConfig);
    await store.init();

    const memory = await store.addMemory({
      content: 'still works',
      tags: [],
      kind: 'note',
    });
    assert.ok(memory.id);
    assert.equal(memory.content, 'still works');

    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });
});
