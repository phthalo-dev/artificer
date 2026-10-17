import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  ensureWorktree,
  inspectRemoval,
  prepareWorkspace,
  removeWorkspace,
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
  await assert.rejects(fs.access(path.join(checkout, 'dirty.txt')));
  assert.equal(
    (await git(['-C', checkout, 'status', '--porcelain'])).trim(),
    '',
  );
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

test('inspectRemoval allows a checkout that is already gone', async () => {
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-rm-'));
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  await fs.mkdir(workspaceDir, { recursive: true });
  assert.deepEqual(
    await inspectRemoval({
      execRoot,
      workstreamId: 'ws-1',
      workspaceDir,
      force: false,
    }),
    { ok: true },
  );
});

test('force removal discards the checkout and keeps an unmerged branch', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-rm-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  const repoDir = path.join(workspaceDir, 'repo');
  await ensureWorktree({ execRoot, repo, workstreamId: 'ws-1', workspaceDir });
  await git(['-C', repoDir, 'config', 'user.email', 't@t.test']);
  await git(['-C', repoDir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(repoDir, 'new.txt'), 'new\n');
  await git(['-C', repoDir, 'add', 'new.txt']);
  await git(['-C', repoDir, 'commit', '-q', '-m', 'new work']);

  await removeWorkspace({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
    force: true,
  });

  await assert.rejects(fs.access(repoDir));
  const ref = await git([
    '-C',
    repoCheckout(execRoot, 'app'),
    'show-ref',
    '--verify',
    'refs/heads/artificer/ws-1',
  ]);
  assert.ok(ref.trim().length > 0);
});

test('remove refuses a dirty worktree until force', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-rm-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  await ensureWorktree({ execRoot, repo, workstreamId: 'ws-1', workspaceDir });
  await fs.writeFile(path.join(workspaceDir, 'repo', 'dirty.txt'), 'x\n');
  const blocked = await inspectRemoval({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
    force: false,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /uncommitted/i);
  await removeWorkspace({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
    force: true,
  });
  await assert.rejects(fs.access(path.join(workspaceDir, 'repo')));
});

test('removing a detached worktree leaves a sibling artificer branch', async () => {
  const { origin, commit } = await bareOriginWithCommit();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-rm-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const named = path.join(execRoot, 'workspace', 'ws-1');
  const detached = path.join(execRoot, 'workspace', 'ws-2');
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir: named,
  });
  await ensureWorktree({
    execRoot,
    repo,
    workstreamId: 'ws-2',
    workspaceDir: detached,
    baseCommit: commit,
  });
  await removeWorkspace({
    execRoot,
    repo,
    workstreamId: 'ws-2',
    workspaceDir: detached,
    force: true,
  });
  const ref = await git([
    '-C',
    repoCheckout(execRoot, 'app'),
    'show-ref',
    '--verify',
    'refs/heads/artificer/ws-1',
  ]);
  assert.ok(ref.trim().length > 0);
});

test('removing a worktree keeps its unmerged branch', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-rm-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  const repoDir = path.join(workspaceDir, 'repo');
  await ensureWorktree({ execRoot, repo, workstreamId: 'ws-1', workspaceDir });
  await git(['-C', repoDir, 'config', 'user.email', 't@t.test']);
  await git(['-C', repoDir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(repoDir, 'new.txt'), 'new\n');
  await git(['-C', repoDir, 'add', 'new.txt']);
  await git(['-C', repoDir, 'commit', '-q', '-m', 'new work']);

  await removeWorkspace({
    execRoot,
    repo,
    workstreamId: 'ws-1',
    workspaceDir,
    force: false,
  });

  await assert.rejects(fs.access(repoDir));
  const ref = await git([
    '-C',
    repoCheckout(execRoot, 'app'),
    'show-ref',
    '--verify',
    'refs/heads/artificer/ws-1',
  ]);
  assert.ok(ref.trim().length > 0);
});

test('a failed first clone leaves no partial checkout', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-wt-'));
  const template = path.join(execRoot, 'template');
  await fs.mkdir(path.join(template, 'hooks'), { recursive: true });
  const hook = path.join(template, 'hooks', 'post-checkout');
  await fs.writeFile(hook, '#!/bin/sh\nexit 3\n');
  await fs.chmod(hook, 0o755);
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  await assert.rejects(
    ensureWorktree({
      execRoot,
      repo,
      workstreamId: 'ws-1',
      workspaceDir: path.join(execRoot, 'workspace', 'ws-1'),
      env: { ...process.env, GIT_TEMPLATE_DIR: template },
    }),
  );
  await assert.rejects(fs.access(repoCheckout(execRoot, 'app')));
});

test('an unlisted worktree is removed from the checkout it came from', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-rm-'));
  const repo = { id: 'app', url: origin, baseBranch: 'main' };
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  await ensureWorktree({ execRoot, repo, workstreamId: 'ws-1', workspaceDir });
  const input = { execRoot, workstreamId: 'ws-1', workspaceDir };
  assert.deepEqual(await inspectRemoval({ ...input, force: false }), {
    ok: true,
  });
  await removeWorkspace({ ...input, force: false });
  await assert.rejects(fs.access(path.join(workspaceDir, 'repo')));
  await fs.access(path.join(repoCheckout(execRoot, 'app'), '.git'));
});

test('a standalone clone with an unpushed commit needs force', async () => {
  const origin = await bareOrigin();
  const execRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-rm-'));
  const workspaceDir = path.join(execRoot, 'workspace', 'ws-1');
  const repoDir = path.join(workspaceDir, 'repo');
  await git(['clone', '-q', origin, repoDir]);
  const input = { execRoot, workstreamId: 'ws-1', workspaceDir };
  assert.deepEqual(await inspectRemoval({ ...input, force: false }), {
    ok: true,
  });
  await git(['-C', repoDir, 'config', 'user.email', 't@t.test']);
  await git(['-C', repoDir, 'config', 'user.name', 'Test']);
  await git(['-C', repoDir, 'commit', '-q', '--allow-empty', '-m', 'local']);
  const blocked = await inspectRemoval({ ...input, force: false });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /unpushed/);
  await removeWorkspace({ ...input, force: true });
  await assert.rejects(fs.access(workspaceDir));
  await assert.rejects(fs.access(path.join(execRoot, 'repos')));
});
