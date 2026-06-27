import { execFile } from 'node:child_process';
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

  constructor(
    rootDir: string,
    syncConfig: IdentityConfig,
    github?: GitHubConfig,
  ) {
    super(rootDir);
    this.syncConfig = syncConfig;
    this.github = github;
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
    patch: Partial<Pick<Memory, 'content' | 'title' | 'summary' | 'tags'>>,
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

  private async commitAndPush(action: string): Promise<void> {
    if (!this.syncConfig.autoCommit) return;

    const prefix = this.syncConfig.commitPrefix ?? 'memory:';
    const message = `${prefix} ${action}`;
    const dir = this.layout.root;
    const env = buildGitEnv(this.github);

    try {
      await exec('git', ['-C', dir, 'add', 'identity/'], { env });
    } catch (err) {
      console.error('[identity-git-sync] git add failed:', err);
      return;
    }

    try {
      await exec('git', ['-C', dir, 'commit', '-m', message], { env });
    } catch (err) {
      // "nothing to commit" exits with code 1 — not a real error
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('nothing to commit') && !msg.includes('nothing added')) {
        console.error('[identity-git-sync] git commit failed:', err);
      }
      return;
    }

    if (!this.syncConfig.autoPush) return;

    const remote = this.syncConfig.remote ?? 'origin';
    let branch = this.syncConfig.branch;
    if (!branch) {
      const { stdout: branchOut } = await exec('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { env });
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
      if (msg.includes('couldn\'t find remote ref') || msg.includes('no such ref')) {
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
}
