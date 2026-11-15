import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { promisify } from 'node:util';
import { hasUncommittedChanges } from './git-ops.js';

const exec = promisify(execFile);

async function tempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-gitops-'));
  await exec('git', ['-C', dir, 'init', '-q']);
  await exec('git', ['-C', dir, 'config', 'user.email', 't@t.test']);
  await exec('git', ['-C', dir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
  await exec('git', ['-C', dir, 'add', '-A']);
  await exec('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
  return dir;
}

test('hasUncommittedChanges is false for a clean repo', async () => {
  const dir = await tempRepo();
  assert.equal(await hasUncommittedChanges(dir), false);
});

test('hasUncommittedChanges is true after editing a tracked file', async () => {
  const dir = await tempRepo();
  await fs.writeFile(path.join(dir, 'a.txt'), 'changed\n');
  assert.equal(await hasUncommittedChanges(dir), true);
});

test('hasUncommittedChanges is true for a new untracked file', async () => {
  const dir = await tempRepo();
  await fs.writeFile(path.join(dir, 'b.txt'), 'new\n');
  assert.equal(await hasUncommittedChanges(dir), true);
});

test('hasUncommittedChanges is false for a non-repo path', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-nogit-'));
  assert.equal(await hasUncommittedChanges(dir), false);
});
