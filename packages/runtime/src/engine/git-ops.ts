import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Whether the working tree has uncommitted changes (tracked edits or untracked
 * files) — i.e. a candidate patch exists. Used by the workstream state machine
 * to decide the implement → review transition. Returns false for a non-repo.
 */
export async function hasUncommittedChanges(repoDir: string): Promise<boolean> {
  try {
    const { stdout } = await exec(
      'git',
      ['-C', repoDir, 'status', '--porcelain'],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Deterministically clone a repo into `{workspaceDir}/repo` and check out the
 * base commit — the state machine's setup step, so routing never depends on an
 * LLM remembering to clone. Mirrors the bench preflight clone. Throws on
 * failure so the caller can mark the workstream blocked (setup_failed).
 */
export async function cloneRepoIntoWorkspace(
  workspaceDir: string,
  repoUrl: string,
  baseCommit?: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  await fs.mkdir(workspaceDir, { recursive: true });
  const repoDir = path.join(workspaceDir, 'repo');
  await exec('git', ['clone', '--depth', '1', repoUrl, 'repo'], {
    cwd: workspaceDir,
    env,
    timeout: 120_000,
  });
  if (baseCommit) {
    const known = await exec('git', [
      '-C',
      repoDir,
      'cat-file',
      '-e',
      `${baseCommit}^{commit}`,
    ])
      .then(() => true)
      .catch(() => false);
    if (!known) {
      await exec(
        'git',
        ['-C', repoDir, 'fetch', '--depth', '1', 'origin', baseCommit],
        {
          env,
          timeout: 120_000,
        },
      ).catch(() => undefined);
    }
    await exec('git', ['-C', repoDir, 'checkout', baseCommit], {
      env,
      timeout: 30_000,
    });
  }
  return repoDir;
}
