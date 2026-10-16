import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  ensureWorktree,
  prepareWorkspace,
  repoCheckout,
} from './worktrees.js';

const exec = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args);
  return stdout;
}

async function createBareOrigin(): Promise<{
  origin: string;
  commit: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-origin-'));
  const seed = path.join(root, 'seed');
  const origin = path.join(root, 'origin.git');
  await fs.mkdir(seed);
  await git(['-C', seed, 'init', '-q', '-b', 'main']);
  await git(['-C', seed, 'config', 'user.email', 't@t.test']);
  await git(['-C', seed, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(seed, 'a.txt'), 'one\n');
  await git(['-C', seed, 'add', '-A']);
  await git(['-C', seed, 'commit', '-q', '-m', 'init']);
  const commit = (await git(['-C', seed, 'rev-parse', 'HEAD'])).trim();
  await git(['clone', '--bare', seed, origin]);
  return { origin, commit };
}

async function bareOrigin(): Promise<string> {
  return (await createBareOrigin()).origin;
}

async function bareOriginWithCommit(): Promise<{
  origin: string;
  commit: string;
}> {
  return createBareOrigin();
}

test('two workstreams get branches from one detached checkout', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const first = path.join(execRoot, 'workspace', 'ws-1');
  const second = path.join(execRoot, 'workspace', 'ws-2');
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir: first,
  });
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-2',
    workspaceDir: second,
  });

  const head = await git([
    '-C',
    repoCheckout(execRoot, 'app'),
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
  assert.equal(head.trim(), 'HEAD');
  const branch = await git([
    '-C',
    path.join(first, 'repo'),
    'branch',
    '--show-current',
  ]);
  assert.equal(branch.trim(), 'artificer/ws-1');
  const other = await git([
    '-C',
    path.join(second, 'repo'),
    'branch',
    '--show-current',
  ]);
  assert.equal(other.trim(), 'artificer/ws-2');
});

test('a dirty shared checkout keeps its HEAD and still adds a worktree', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const first = path.join(execRoot, 'workspace', 'ws-1');
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir: first,
  });
  const checkout = repoCheckout(execRoot, 'app');
  const before = (await git(['-C', checkout, 'rev-parse', 'HEAD'])).trim();
  await fs.writeFile(path.join(checkout, 'dirty.txt'), 'x\n');
  const second = path.join(execRoot, 'workspace', 'ws-2');
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-2',
    workspaceDir: second,
  });
  const after = (await git(['-C', checkout, 'rev-parse', 'HEAD'])).trim();
  assert.equal(after, before);
  const branch = (
    await git(['-C', path.join(second, 'repo'), 'branch', '--show-current'])
  ).trim();
  assert.equal(branch, 'artificer/ws-2');
});

test('ensureWorktree is a no-op when the worktree is already linked', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
  });
  const before = (
    await git(['-C', path.join(workspaceDir, 'repo'), 'rev-parse', 'HEAD'])
  ).trim();
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
  });
  const after = (
    await git(['-C', path.join(workspaceDir, 'repo'), 'rev-parse', 'HEAD'])
  ).trim();
  assert.equal(after, before);
});

test('ensureWorktree reattaches an existing branch when the directory is gone', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
  });
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
  });
  const branch = (
    await git([
      '-C',
      path.join(workspaceDir, 'repo'),
      'branch',
      '--show-current',
    ])
  ).trim();
  assert.equal(branch, 'artificer/ws-1');
});

test('baseCommit checks out detached', async () => {
  const { origin, commit } = await bareOriginWithCommit();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
    baseCommit: commit,
  });
  const branch = (
    await git([
      '-C',
      path.join(workspaceDir, 'repo'),
      'branch',
      '--show-current',
    ])
  ).trim();
  assert.equal(branch, '');
  const head = (
    await git(['-C', path.join(workspaceDir, 'repo'), 'rev-parse', 'HEAD'])
  ).trim();
  assert.equal(head, commit);
});

test('baseCommit reattaches detached when the directory is gone', async () => {
  const { origin, commit } = await bareOriginWithCommit();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
    baseCommit: commit,
  });
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
    baseCommit: commit,
  });
  const branch = (
    await git([
      '-C',
      path.join(workspaceDir, 'repo'),
      'branch',
      '--show-current',
    ])
  ).trim();
  assert.equal(branch, '');
  const head = (
    await git(['-C', path.join(workspaceDir, 'repo'), 'rev-parse', 'HEAD'])
  ).trim();
  assert.equal(head, commit);
});

test('Promise.all of two worktrees for one repo yields two branches', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const first = path.join(execRoot, 'workspace', 'ws-1');
  const second = path.join(execRoot, 'workspace', 'ws-2');
  await Promise.all([
    ensureWorktree({
      execRoot,
      repo,
      workstreamId: 'ws-1',
      workspaceDir: first,
    }),
    ensureWorktree({
      execRoot,
      repo,
      workstreamId: 'ws-2',
      workspaceDir: second,
    }),
  ]);
  const a = (
    await git(['-C', path.join(first, 'repo'), 'branch', '--show-current'])
  ).trim();
  const b = (
    await git(['-C', path.join(second, 'repo'), 'branch', '--show-current'])
  ).trim();
  assert.equal(a, 'artificer/ws-1');
  assert.equal(b, 'artificer/ws-2');
});

test('a listed repo prepares a worktree', async () => {
  const origin = await bareOrigin();
  const repoUrl = 'https://github.com/acme/app';
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${origin}/.insteadOf`,
    GIT_CONFIG_VALUE_0: repoUrl,
  };
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-prep-'));
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  const kind = await prepareWorkspace({
    execRoot,
    repos: [{ id: 'app', url: repoUrl, baseBranch: 'main' }],
    repoUrl,
    workstreamId: 'ws-1',
    workspaceDir,
    env,
  });
  assert.equal(kind, 'worktree');
  const gitPath = path.join(workspaceDir, 'repo', '.git');
  const stat = await fs.stat(gitPath);
  assert.equal(stat.isFile(), true);
});

test('duplicate allowlist URLs fall back to a shallow clone', async () => {
  const origin = await bareOrigin();
  const repoUrl = 'https://github.com/acme/app';
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${origin}/.insteadOf`,
    GIT_CONFIG_VALUE_0: repoUrl,
  };
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-prep-'));
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-9');
  const kind = await prepareWorkspace({
    execRoot,
    repos: [
      { id: 'app', url: repoUrl, baseBranch: 'main' },
      { id: 'app2', url: repoUrl, baseBranch: 'main' },
    ],
    repoUrl,
    workstreamId: 'ws-9',
    workspaceDir,
    env,
  });
  assert.equal(kind, 'clone');
  const stat = await fs.stat(path.join(workspaceDir, 'repo', '.git'));
  assert.equal(stat.isDirectory(), true);
});
