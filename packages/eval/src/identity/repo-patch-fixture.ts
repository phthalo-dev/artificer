import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { FIXTURE_REPO_URL, type EvalRepoPin } from '../types.js';
import { copyDir } from './greenfield-fixture.js';

const execFileAsync = promisify(execFile);

export const INTRODUCE_BUG_PATCH = 'introduce-bug.patch';

export interface MaterializedRepoPatch {
  repoDir: string;
  baseCommit: string;
  cleanup: () => Promise<void>;
}

export interface MaterializeRepoPatchOptions {
  repo: EvalRepoPin;
  /** Task `fixture/` directory (vendored snapshot + optional introduce-bug.patch). */
  fixtureDir?: string;
}

/**
 * Prepares a sandboxed git repo for a `repo-patch` task.
 *
 * - `repo.url === "fixture"`: copy vendored fixture files (excluding the bug
 *   patch) into a fresh git repo, then optionally apply `introduce-bug.patch`.
 * - Otherwise: shallow-clone the remote URL at `repo.baseCommit`, then apply
 *   the optional introduce-bug patch from `fixtureDir` if present.
 *
 * The returned `baseCommit` is always the HEAD the agent should start from
 * (after any introduce-bug patch has been committed).
 */
export async function materializeRepoPatch(
  options: MaterializeRepoPatchOptions,
): Promise<MaterializedRepoPatch> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-repo-patch-'),
  );
  const repoDir = path.join(rootDir, 'repo');

  try {
    if (options.repo.url === FIXTURE_REPO_URL) {
      if (!options.fixtureDir) {
        throw new Error(
          'repo-patch with url "fixture" requires a task fixture/ directory',
        );
      }
      await materializeFromFixture(options.fixtureDir, repoDir);
    } else {
      await clonePinnedRepo(options.repo, repoDir);
      if (options.fixtureDir) {
        await applyIntroduceBugPatch(options.fixtureDir, repoDir);
      }
    }

    const baseCommit = (await git(repoDir, ['rev-parse', 'HEAD'])).trim();
    return {
      repoDir,
      baseCommit,
      cleanup: () => fs.rm(rootDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function materializeFromFixture(
  fixtureDir: string,
  repoDir: string,
): Promise<void> {
  await fs.mkdir(repoDir, { recursive: true });
  await copyFixtureExcludingBugPatch(fixtureDir, repoDir);
  await git(repoDir, ['init', '-q']);
  await git(repoDir, ['config', 'user.email', 'eval@artificer.local']);
  await git(repoDir, ['config', 'user.name', 'artificer-eval']);
  await git(repoDir, ['add', '-A']);
  await git(repoDir, ['commit', '-q', '-m', 'fixture']);
  await applyIntroduceBugPatch(fixtureDir, repoDir);
}

async function copyFixtureExcludingBugPatch(
  fixtureDir: string,
  dest: string,
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(fixtureDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === INTRODUCE_BUG_PATCH) continue;
    const source = path.join(fixtureDir, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(source, target);
    } else {
      await fs.copyFile(source, target);
    }
  }
}

async function clonePinnedRepo(
  repo: EvalRepoPin,
  repoDir: string,
): Promise<void> {
  await execFileAsync('git', ['clone', '--quiet', repo.url, repoDir]);
  await git(repoDir, ['config', 'user.email', 'eval@artificer.local']);
  await git(repoDir, ['config', 'user.name', 'artificer-eval']);
  try {
    await git(repoDir, ['cat-file', '-e', `${repo.baseCommit}^{commit}`]);
  } catch {
    await git(repoDir, ['fetch', '--depth', '1', 'origin', repo.baseCommit]);
  }
  await git(repoDir, ['checkout', '-q', repo.baseCommit]);
}

/**
 * Applies `fixture/introduce-bug.patch` when present and commits the result so
 * the agent starts from a known failing tree.
 */
export async function applyIntroduceBugPatch(
  fixtureDir: string,
  repoDir: string,
): Promise<boolean> {
  const patchPath = path.join(fixtureDir, INTRODUCE_BUG_PATCH);
  try {
    await fs.access(patchPath);
  } catch {
    return false;
  }

  await execFileAsync('git', ['apply', '--whitespace=nowarn', patchPath], {
    cwd: repoDir,
  });
  await git(repoDir, ['add', '-A']);
  const status = (await git(repoDir, ['status', '--porcelain'])).trim();
  if (!status) return true;
  await git(repoDir, ['commit', '-q', '-m', 'introduce-bug']);
  return true;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}
