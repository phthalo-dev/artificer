import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RepoConfig } from '../api/types.js';
import { cloneRepoIntoWorkspace, hasUncommittedChanges } from './git-ops.js';
import { loadRepos, matchRepo } from './repos.js';

const exec = promisify(execFile);
const repoChains = new Map<string, Promise<void>>();

export interface EnsureWorktreeInput {
  execRoot: string;
  repo: RepoConfig;
  workstreamId: string;
  workspaceDir: string;
  baseCommit?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RemovalInput extends EnsureWorktreeInput {
  force: boolean;
  status?: string;
  pullRequestUrls?: string[];
}

export async function prepareWorkspace(input: {
  execRoot: string;
  repos: unknown;
  repoUrl: string;
  workstreamId: string;
  workspaceDir: string;
  baseCommit?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<'worktree' | 'clone'> {
  const loaded = loadRepos(input.repos);
  const repo = loaded.ok ? matchRepo(loaded.repos, input.repoUrl) : undefined;

  if (!repo) {
    await cloneRepoIntoWorkspace(
      input.workspaceDir,
      input.repoUrl,
      input.baseCommit,
      input.env,
    );
    return 'clone';
  }

  await ensureWorktree({
    execRoot: input.execRoot,
    repo,
    workstreamId: input.workstreamId,
    workspaceDir: input.workspaceDir,
    baseCommit: input.baseCommit,
    env: input.env,
  });
  return 'worktree';
}

export function repoCheckout(root: string, repoId: string): string {
  return path.join(root, 'repos', repoId);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function withRepoChain<T>(
  repoId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = repoChains.get(repoId) ?? Promise.resolve();
  let result!: T;
  const next = previous
    .catch(() => {})
    .then(async () => {
      result = await fn();
    });
  repoChains.set(repoId, next);
  await next;
  return result;
}

async function git(
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  timeout?: number,
): Promise<string> {
  const { stdout } = await exec('git', args, { env, timeout });
  return stdout;
}

async function isLinkedWorktree(
  checkout: string,
  target: string,
  env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
  if (!(await pathExists(path.join(target, '.git')))) return false;

  try {
    const [checkoutCommonDir, targetCommonDir] = await Promise.all([
      git(['-C', checkout, 'rev-parse', '--git-common-dir'], env),
      git(['-C', target, 'rev-parse', '--git-common-dir'], env),
    ]);
    const [resolvedCheckoutDir, resolvedTargetDir] = await Promise.all([
      fs.realpath(path.resolve(checkout, checkoutCommonDir.trim())),
      fs.realpath(path.resolve(target, targetCommonDir.trim())),
    ]);
    return resolvedCheckoutDir === resolvedTargetDir;
  } catch {
    return false;
  }
}

export async function ensureWorktree(
  input: EnsureWorktreeInput,
): Promise<{ repoDir: string }> {
  await fs.mkdir(input.workspaceDir, { recursive: true });

  return withRepoChain(input.repo.id, async () => {
    const checkout = repoCheckout(input.execRoot, input.repo.id);
    const target = path.join(input.workspaceDir, 'repo');
    const baseRef = `origin/${input.repo.baseBranch}`;

    if (!(await pathExists(checkout))) {
      await fs.mkdir(path.dirname(checkout), { recursive: true });
      await git(['clone', input.repo.url, checkout], input.env, 120_000);
      await git(
        ['-C', checkout, 'checkout', '--detach', baseRef],
        input.env,
        30_000,
      );
    }

    await git(['-C', checkout, 'fetch', 'origin'], input.env, 120_000);

    const status = await git(
      ['-C', checkout, 'status', '--porcelain'],
      input.env,
    );
    if (status.trim() === '') {
      await git(
        ['-C', checkout, 'checkout', '--detach', baseRef],
        input.env,
        30_000,
      );
    }

    if (await isLinkedWorktree(checkout, target, input.env)) {
      return { repoDir: target };
    }

    if (input.baseCommit) {
      const commitRef = `${input.baseCommit}^{commit}`;
      const known = await git(
        ['-C', checkout, 'cat-file', '-e', commitRef],
        input.env,
      )
        .then(() => true)
        .catch(() => false);
      if (!known) {
        await git(
          ['-C', checkout, 'fetch', 'origin', input.baseCommit],
          input.env,
          120_000,
        );
      }
      await git(['-C', checkout, 'worktree', 'prune'], input.env);
      await git(
        [
          '-C',
          checkout,
          'worktree',
          'add',
          '--detach',
          target,
          input.baseCommit,
        ],
        input.env,
        30_000,
      );
      return { repoDir: target };
    }

    const branch = `artificer/${input.workstreamId}`;
    const branchExists = await git(
      [
        '-C',
        checkout,
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${branch}`,
      ],
      input.env,
    )
      .then(() => true)
      .catch(() => false);

    if (branchExists && !(await pathExists(target))) {
      await git(['-C', checkout, 'worktree', 'prune'], input.env);
      await git(
        ['-C', checkout, 'worktree', 'add', target, branch],
        input.env,
        30_000,
      );
      return { repoDir: target };
    }

    await git(
      ['-C', checkout, 'worktree', 'add', '-b', branch, target, baseRef],
      input.env,
      30_000,
    );
    return { repoDir: target };
  });
}

const BUSY_STATUSES = new Set([
  'pending',
  'planning',
  'reviewing',
  'in_progress',
]);

export async function inspectRemoval(
  input: RemovalInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (input.status && BUSY_STATUSES.has(input.status)) {
    return {
      ok: false,
      reason: `workstream status is ${input.status}`,
    };
  }

  const repoDir = path.join(input.workspaceDir, 'repo');
  if (input.force) return { ok: true };
  if (await hasUncommittedChanges(repoDir)) {
    return { ok: false, reason: 'worktree has uncommitted changes' };
  }

  const pushed = await git(
    [
      '-C',
      repoDir,
      'merge-base',
      '--is-ancestor',
      'HEAD',
      `origin/${input.repo.baseBranch}`,
    ],
    input.env,
  )
    .then(() => true)
    .catch(() => false);
  if (pushed) return { ok: true };

  for (const url of input.pullRequestUrls ?? []) {
    const headRefOid = await exec(
      'gh',
      ['pr', 'view', url, '--json', 'headRefOid'],
      { env: input.env },
    )
      .then(({ stdout }) => {
        const value = JSON.parse(stdout) as { headRefOid?: unknown };
        return typeof value.headRefOid === 'string'
          ? value.headRefOid
          : undefined;
      })
      .catch(() => undefined);
    if (!headRefOid) continue;
    const included = await git(
      ['-C', repoDir, 'merge-base', '--is-ancestor', 'HEAD', headRefOid],
      input.env,
    )
      .then(() => true)
      .catch(() => false);
    if (included) return { ok: true };
  }

  return { ok: false, reason: 'worktree has unpushed commits' };
}

export async function removeWorkspace(input: RemovalInput): Promise<void> {
  await withRepoChain(input.repo.id, async () => {
    const repoDir = path.join(input.workspaceDir, 'repo');
    let gitStat;
    try {
      gitStat = await fs.stat(path.join(repoDir, '.git'));
    } catch {
      return;
    }

    if (gitStat.isDirectory()) {
      await fs.rm(input.workspaceDir, { recursive: true, force: true });
      return;
    }
    if (!gitStat.isFile()) return;

    const checkout = repoCheckout(input.execRoot, input.repo.id);
    const branch = (
      await git(['-C', repoDir, 'branch', '--show-current'], input.env)
    ).trim();
    const removeArgs = ['-C', checkout, 'worktree', 'remove'];
    if (input.force) removeArgs.push('--force');
    removeArgs.push(repoDir);
    await git(removeArgs, input.env, 30_000);

    if (branch === `artificer/${input.workstreamId}`) {
      const deleteBranch = git(
        ['-C', checkout, 'branch', input.force ? '-D' : '-d', branch],
        input.env,
      );
      if (input.force) {
        await deleteBranch;
      } else {
        await deleteBranch.catch(() => undefined);
      }
    }
  });
}
