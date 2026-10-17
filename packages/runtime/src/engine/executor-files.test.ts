import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { emptyUsage, type RunRecord } from '../storage/types.js';
import { ClaudeCodeExecutor } from './claude-code-executor.js';
import { CursorAgentExecutor } from './cursor-executor.js';
import {
  abortAgent,
  executorStateDir,
  reapAgentGroups,
  writeProjectFile,
} from './executor-files.js';
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

test('removeOriginRemote keeps origin on a linked worktree and blocks its push', async () => {
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
  const sibling = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-oc-'));
  await git([
    '-C',
    shared,
    'worktree',
    'add',
    '-q',
    '--detach',
    path.join(workspace, 'repo'),
  ]);
  await git([
    '-C',
    shared,
    'worktree',
    'add',
    '-q',
    '-b',
    'other',
    path.join(sibling, 'repo'),
  ]);
  removeOriginRemote(workspace);
  assert.equal((await git(['-C', shared, 'remote'])).trim(), 'origin');
  assert.equal(
    (
      await git([
        '-C',
        path.join(workspace, 'repo'),
        'config',
        '--worktree',
        '--get',
        'remote.origin.pushurl',
      ])
    ).trim(),
    'no-push://artificer.invalid/blocked',
  );
  await assert.rejects(
    git([
      '-C',
      path.join(sibling, 'repo'),
      'config',
      '--worktree',
      '--get',
      'remote.origin.pushurl',
    ]),
  );
  await assert.rejects(
    exec('git', ['-C', path.join(workspace, 'repo'), 'push', 'origin', 'HEAD']),
    (error: unknown) => {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      assert.match(stderr, /remote-no-push|artificer\.invalid/);
      return true;
    },
  );
});

test('writeProjectFile hides a generated file only in that worktree', async () => {
  const shared = await repo();
  const wt = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const sibling = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  await git(['-C', shared, 'worktree', 'add', '-q', '-b', 'wt', wt]);
  await git(['-C', shared, 'worktree', 'add', '-q', '-b', 'sib', sibling]);
  const restore = writeProjectFile(wt, 'opencode.json', '{}');
  const raw = (
    await git(['-C', shared, 'rev-parse', '--git-path', 'info/exclude'])
  ).trim();
  const excludePath = path.isAbsolute(raw) ? raw : path.resolve(raw);
  const sharedExclude = await fs.readFile(excludePath, 'utf8').catch(() => '');
  assert.equal(sharedExclude.includes('opencode.json'), false);
  assert.equal((await git(['-C', wt, 'status', '--porcelain'])).trim(), '');
  await fs.writeFile(path.join(sibling, 'opencode.json'), '{}');
  assert.match(
    await git(['-C', sibling, 'status', '--porcelain']),
    /opencode\.json/,
  );
  restore();
});

test('abort SIGKILLs grandchildren after the agent exits', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-abort-'));
  const pidFile = path.join(dir, 'grandchild.pid');
  const scriptPath = path.join(dir, 'agent');
  await fs.writeFile(
    scriptPath,
    `#!/bin/sh
trap 'exit 0' TERM
"$NODE" -e 'process.on("SIGTERM",()=>{}); process.on("SIGHUP",()=>{}); require("fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(()=>{},1000);' "$PIDFILE" &
while [ ! -f "$PIDFILE" ]; do sleep 0.02; done
sleep 30
`,
  );
  await fs.chmod(scriptPath, 0o755);
  const child = spawn(scriptPath, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE: process.execPath, PIDFILE: pidFile },
  });
  const controller = new AbortController();
  let stop = (): void => undefined;
  const closed = new Promise((resolve) => {
    child.on('close', () => {
      stop();
      resolve(undefined);
    });
  });
  stop = abortAgent(child, controller.signal, () => undefined);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fs.access(pidFile);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const pid = Number(await fs.readFile(pidFile, 'utf8'));
  assert.ok(pid > 0);
  controller.abort();
  await closed;
  let dead = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      dead = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already dead */
  }
  assert.equal(dead, true);
});

test('reapAgentGroups kills a detached agent still running at exit', async () => {
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  const pid = child.pid;
  assert.ok(pid);
  abortAgent(child, undefined, () => undefined);
  reapAgentGroups();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.throws(() => process.kill(pid, 0));
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
