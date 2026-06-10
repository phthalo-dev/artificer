import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { hasMeaningfulPatch } from './patch-facts.js';

const exec = promisify(execFile);

async function tempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-patch-'));
  await exec('git', ['-C', dir, 'init', '-q']);
  await exec('git', ['-C', dir, 'config', 'user.email', 't@t.test']);
  await exec('git', ['-C', dir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
  await exec('git', ['-C', dir, 'add', '-A']);
  await exec('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
  return dir;
}

test('hasMeaningfulPatch is false for a clean repo', async () => {
  const dir = await tempRepo();
  assert.equal(await hasMeaningfulPatch(dir), false);
});

test('hasMeaningfulPatch is true after editing a tracked file', async () => {
  const dir = await tempRepo();
  await fs.writeFile(path.join(dir, 'a.txt'), 'changed\n');
  assert.equal(await hasMeaningfulPatch(dir), true);
});

test('hasMeaningfulPatch is true for an untracked file', async () => {
  const dir = await tempRepo();
  await fs.writeFile(path.join(dir, 'b.txt'), 'new\n');
  assert.equal(await hasMeaningfulPatch(dir), true);
});

test('hasMeaningfulPatch finds repo in workspace subdirectory', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-patch-ws-'));
  const repo = path.join(workspace, 'repo');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['-C', repo, 'init', '-q']);
  await exec('git', ['-C', repo, 'config', 'user.email', 't@t.test']);
  await exec('git', ['-C', repo, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(repo, 'x.txt'), 'x\n');
  await exec('git', ['-C', repo, 'add', '-A']);
  await exec('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  await fs.writeFile(path.join(repo, 'x.txt'), 'y\n');
  assert.equal(await hasMeaningfulPatch(workspace), true);
});

test('hasMeaningfulPatch is false when no git repo exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-patch-nogit-'));
  assert.equal(await hasMeaningfulPatch(dir), false);
});
