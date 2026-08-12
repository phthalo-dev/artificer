import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitHubConfig } from '../config.js';
import { buildGitEnv } from '../tools/git-env.js';
import type { IdentityConfig } from '../api/types.js';
import { IdentityStore } from './identity-store.js';
import type { Memory } from './types.js';

const exec = promisify(execFile);

export class IdentityGitSync extends IdentityStore {
  private readonly syncConfig: IdentityConfig;
  private readonly github: GitHubConfig | undefined;
  private readonly evalMode: boolean;
  private gitQueue: Promise<void> = Promise.resolve();

  constructor(
    rootDir: string,
    syncConfig: IdentityConfig,
    github?: GitHubConfig,
    evalMode = false,
  ) {
    super(rootDir, { embeddings: syncConfig.embeddings });
    this.syncConfig = syncConfig;
    this.github = github;
    this.evalMode = evalMode;
  }

  override async addMemory(
    input: Omit<Memory, 'id' | 'createdAt'>,
  ): Promise<Memory> {
    const memory = await super.addMemory(input);
    await this.commitAndPush(`add ${memory.id}`);
    return memory;
  }

  override async updateMemory(
    id: string,
    patch: Partial<
      Pick<
        Memory,
        | 'content'
        | 'title'
        | 'summary'
        | 'tags'
        | 'related'
        | 'kind'
        | 'sourceHash'
        | 'sourceCommit'
      >
    >,
  ): Promise<Memory | null> {
    const memory = await super.updateMemory(id, patch);
    if (memory) await this.commitAndPush(`update ${memory.id}`);
    return memory;
  }

  override async deleteMemory(id: string): Promise<boolean> {
    const deleted = await super.deleteMemory(id);
    if (deleted) await this.commitAndPush(`delete ${id}`);
    return deleted;
  }

  pullFromRemote(): Promise<'updated' | 'unchanged' | 'conflict' | 'error'> {
    if (this.evalMode) return Promise.resolve('unchanged');
    return this.enqueue(() => this.doPullFromRemote());
  }

  commitPaths(action: string, paths: string[]): Promise<void> {
    if (this.evalMode) return Promise.resolve();
    return this.enqueue(() => this.doCommitAndPush(action, paths));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.gitQueue.then(operation, operation);
    this.gitQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private commitAndPush(action: string): Promise<void> {
    if (this.evalMode) return Promise.resolve();
    return this.enqueue(() => this.doCommitAndPush(action));
  }

  private async doCommitAndPush(
    action: string,
    paths?: string[],
  ): Promise<void> {
    const committed = await this.commitDirty(action, paths);
    if (!committed) return;

    if (!this.syncConfig.autoPush) return;

    const dir = this.layout.root;
    const env = buildGitEnv(this.github);
    const remote = this.syncConfig.remote ?? 'origin';
    let branch = this.syncConfig.branch;
    if (!branch) {
      const { stdout: branchOut } = await exec(
        'git',
        ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { env },
      );
      branch = branchOut.trim();
      if (!branch || branch === 'HEAD') branch = undefined;
    }

    try {
      const pullArgs = ['pull', '--rebase', remote];
      if (branch) pullArgs.push(branch);
      await exec('git', ['-C', dir, ...pullArgs], { env });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Remote branch doesn't exist yet (first push) — safe to proceed
      if (
        msg.includes("couldn't find remote ref") ||
        msg.includes('no such ref')
      ) {
        // fall through to push
      } else {
        console.error('[identity-git-sync] git pull --rebase failed:', err);
        return;
      }
    }

    try {
      const pushArgs = ['push', remote];
      if (branch) pushArgs.push(branch);
      await exec('git', ['-C', dir, ...pushArgs], { env });
    } catch (err) {
      console.error('[identity-git-sync] git push failed:', err);
    }
  }

  private async commitDirty(
    action: string,
    commitPaths?: string[],
  ): Promise<boolean> {
    if (!this.syncConfig.autoCommit) return false;

    const prefix = this.syncConfig.commitPrefix ?? 'memory:';
    const message = `${prefix} ${action}`;
    const dir = this.layout.root;
    const env = buildGitEnv(this.github);

    try {
      const paths = [...(commitPaths ?? ['identity/'])];
      if (fs.existsSync(path.join(dir, 'agent', 'schedules'))) {
        if (!paths.includes('agent/schedules/')) paths.push('agent/schedules/');
      }
      await exec('git', ['-C', dir, 'add', ...paths], { env });
    } catch (err) {
      console.error('[identity-git-sync] git add failed:', err);
      return false;
    }

    try {
      await exec('git', ['-C', dir, 'commit', '-m', message], { env });
      return true;
    } catch (err) {
      // "nothing to commit" exits with code 1 — not a real error
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !msg.includes('nothing to commit') &&
        !msg.includes('nothing added')
      ) {
        console.error('[identity-git-sync] git commit failed:', err);
      }
      return false;
    }
  }

  private async doPullFromRemote(): Promise<
    'updated' | 'unchanged' | 'conflict' | 'error'
  > {
    await this.commitDirty('sync schedules');

    const dir = this.layout.root;
    const env = buildGitEnv(this.github);
    const remote = this.syncConfig.remote ?? 'origin';
    let branch = this.syncConfig.branch;

    try {
      const { stdout } = await exec(
        'git',
        ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { env },
      );
      if (!branch) {
        const currentBranch = stdout.trim();
        branch =
          currentBranch && currentBranch !== 'HEAD' ? currentBranch : undefined;
      }
      const { stdout: before } = await exec(
        'git',
        ['-C', dir, 'rev-parse', 'HEAD'],
        { env },
      );
      const pullArgs = ['pull', '--rebase', remote];
      if (branch) pullArgs.push(branch);
      await exec('git', ['-C', dir, ...pullArgs], { env });
      const { stdout: after } = await exec(
        'git',
        ['-C', dir, 'rev-parse', 'HEAD'],
        { env },
      );
      return before.trim() === after.trim() ? 'unchanged' : 'updated';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        /CONFLICT|could not apply|Resolve all conflicts|fix conflicts/i.test(
          message,
        )
      ) {
        try {
          await exec('git', ['-C', dir, 'rebase', '--abort'], { env });
        } catch {
          // Best effort: return the conflict status even if abort itself fails.
        }
        return 'conflict';
      }
      console.error('[identity-git-sync] git pull --rebase failed:', err);
      return 'error';
    }
  }
}
