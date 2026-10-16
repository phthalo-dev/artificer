import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { emptyUsage, type RunRecord } from '../storage/types.js';
import { ClaudeCodeExecutor } from './claude-code-executor.js';
import { CursorAgentExecutor } from './cursor-executor.js';
import { executorStateDir, writeProjectFile } from './executor-files.js';
import { removeOriginRemote } from './opencode-executor.js';

const exec = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args);
  return stdout;
}

async function repo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-exec-files-'));
  await git(['-C', dir, 'init', '-q', '-b', 'main']);
  await git(['-C', dir, 'config', 'user.email', 't@t.test']);
  await git(['-C', dir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
  await git(['-C', dir, 'add', '-A']);
  await git(['-C', dir, 'commit', '-q', '-m', 'init']);
  return dir;
}

test('executorStateDir is outside the workspace', async () => {
  const dir = await repo();
  const state = executorStateDir(dir);
  assert.equal(path.relative(dir, state).startsWith('..'), true);
  assert.equal(executorStateDir(dir), state);
  assert.equal((await git(['-C', dir, 'status', '--porcelain'])).trim(), '');
});

test('writeProjectFile excludes a generated file and removes it after', async () => {
  const dir = await repo();
  const restore = writeProjectFile(
    dir,
    path.join('.cursor', 'mcp.json'),
    '{"mcpServers":{}}',
  );
  assert.equal(
    await fs.readFile(path.join(dir, '.cursor', 'mcp.json'), 'utf8'),
    '{"mcpServers":{}}',
  );
  assert.equal((await git(['-C', dir, 'status', '--porcelain'])).trim(), '');
  restore();
  await assert.rejects(fs.access(path.join(dir, '.cursor')));
  assert.equal((await git(['-C', dir, 'status', '--porcelain'])).trim(), '');
});

test('writeProjectFile puts back a pre-existing project file', async () => {
  const dir = await repo();
  await fs.writeFile(path.join(dir, 'opencode.json'), '{"theme":"dark"}');
  await git(['-C', dir, 'add', 'opencode.json']);
  await git(['-C', dir, 'commit', '-q', '-m', 'config']);
  const restore = writeProjectFile(dir, 'opencode.json', '{"mcp":{}}');
  assert.equal(
    await fs.readFile(path.join(dir, 'opencode.json'), 'utf8'),
    '{"mcp":{}}',
  );
  restore();
  assert.equal(
    await fs.readFile(path.join(dir, 'opencode.json'), 'utf8'),
    '{"theme":"dark"}',
  );
  assert.equal((await git(['-C', dir, 'status', '--porcelain'])).trim(), '');
});

test('removeOriginRemote keeps origin on a linked worktree', async () => {
  const shared = await repo();
  await git([
    '-C',
    shared,
    'remote',
    'add',
    'origin',
    'https://example.test/a',
  ]);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-oc-'));
  await git([
    '-C',
    shared,
    'worktree',
    'add',
    '-q',
    '--detach',
    path.join(workspace, 'repo'),
  ]);
  removeOriginRemote(workspace);
  assert.equal((await git(['-C', shared, 'remote'])).trim(), 'origin');
});

test('removeOriginRemote removes origin from a standalone clone', async () => {
  const source = await repo();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-oc-'));
  await git(['clone', '-q', source, path.join(workspace, 'repo')]);
  removeOriginRemote(workspace);
  assert.equal(
    (await git(['-C', path.join(workspace, 'repo'), 'remote'])).trim(),
    '',
  );
});

const run: RunRecord = {
  id: 'run-1',
  role: 'worker',
  task: 't',
  status: 'running',
  toolCalls: [],
  usage: emptyUsage(),
  createdAt: new Date().toISOString(),
};

async function withFakeBin<T>(
  name: string,
  script: string,
  fn: () => Promise<T>,
): Promise<T> {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-bin-'));
  const file = path.join(bin, name);
  await fs.writeFile(file, script);
  await fs.chmod(file, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous ?? ''}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = previous;
  }
}

test('a claude-code turn leaves the repo clean', async () => {
  const dir = await repo();
  const result = await withFakeBin(
    'claude',
    '#!/bin/sh\ncat >/dev/null\necho reply\n',
    () =>
      new ClaudeCodeExecutor().execute({
        context: 'hi',
        workspaceDir: dir,
        run,
      }),
  );
  assert.equal(result.text, 'reply');
  assert.equal((await git(['-C', dir, 'status', '--porcelain'])).trim(), '');
});

test('a cursor turn sees its MCP config and leaves the repo clean', async () => {
  const dir = await repo();
  const result = await withFakeBin(
    'cursor',
    '#!/bin/sh\nwhile [ "$1" != "--workspace" ]; do shift; done\ntest -f "$2/.cursor/mcp.json" && echo found\n',
    () =>
      new CursorAgentExecutor().execute({
        context: 'hi',
        workspaceDir: dir,
        run,
      }),
  );
  assert.equal(result.text, 'found');
  assert.equal((await git(['-C', dir, 'status', '--porcelain'])).trim(), '');
  await assert.rejects(fs.access(path.join(dir, '.cursor')));
});
