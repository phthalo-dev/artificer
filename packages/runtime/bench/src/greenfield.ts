import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TASKS_DIR, CACHE_DIR } from './config.js';
import type { BenchInstance } from './types.js';

const execFileAsync = promisify(execFile);

/** Fixture tasks live under bench/tasks/greenfield/<task-id>/. */
export const GREENFIELD_FIXTURES_DIR = path.join(TASKS_DIR, 'greenfield');

interface GreenfieldMeta {
  task_id: string;
  display_title?: string;
  test_command: string;
}

/** Recursively copies a directory tree (used for both scaffold and hidden overlays). */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 30_000;

async function acquireLock(lockDir: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await fs.mkdir(lockDir);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for greenfield cache lock: ${lockDir}`);
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
}

async function releaseLock(lockDir: string): Promise<void> {
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Runs `fn` while holding an exclusive, cross-process lock for `taskId`'s
 * shared cache dir (a plain `mkdir`-based mutex — atomic across processes on
 * every platform we run on, no dependency needed). Exported so eval-greenfield
 * (which clones from the same canonical path later, as a separate process)
 * can serialize against a concurrent rebuild too.
 */
export async function withGreenfieldCacheLock<T>(
  taskId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const taskCacheDir = path.join(CACHE_DIR, 'greenfield', taskId);
  await fs.mkdir(taskCacheDir, { recursive: true });
  const lockDir = path.join(taskCacheDir, '.lock');
  await acquireLock(lockDir);
  try {
    return await fn();
  } finally {
    await releaseLock(lockDir);
  }
}

/**
 * Materializes a fixture's scaffold/ directory into a fresh local git repo at
 * a stable, well-known path (eval-greenfield reconstructs this same path
 * later, from just the instance id). Re-materializes on every call so a
 * fixture edit is always picked up (cheap: fixtures are a handful of files).
 * Caller must hold withGreenfieldCacheLock(taskId, ...).
 */
async function materializeScaffold(
  taskId: string,
): Promise<{ repoDir: string; commit: string }> {
  const fixtureDir = path.join(GREENFIELD_FIXTURES_DIR, taskId);
  const repoDir = path.join(CACHE_DIR, 'greenfield', taskId, 'repo');
  await fs.rm(repoDir, { recursive: true, force: true });
  await copyDir(path.join(fixtureDir, 'scaffold'), repoDir);

  const git = (args: string[]) => execFileAsync('git', args, { cwd: repoDir });
  await git(['init', '-q']);
  await git(['config', 'user.email', 'bench@artificer.local']);
  await git(['config', 'user.name', 'artificer-bench']);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'scaffold']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  return { repoDir, commit: stdout.trim() };
}

/**
 * Loads one greenfield fixture into the shared BenchInstance shape.
 *
 * Concurrent bench/external-agent processes running the same suite each call
 * this for the same taskId. The canonical scaffold repo lives at one shared,
 * well-known path (materializeScaffold rebuilds it in place every call) — but
 * whoever gets handed `repository_url` clones from it *outside* this
 * function's control, sometimes much later: for a non-preflight Artificer
 * run, it's the agent's own LLM-issued `git clone` shell command, which
 * driver code has no hook to wrap in a lock. So instead of handing out the
 * shared path directly, rebuild it under lock and immediately clone a
 * private, uniquely-named copy (also under the same lock) — every downstream
 * clone then reads an already-isolated repo, so no further locking is needed
 * at the point of use. This is what a prior parallel run corrupted: two
 * processes' clones interleaved with a third process's rm+rebuild of the one
 * shared path.
 */
export async function loadGreenfieldTask(taskId: string): Promise<BenchInstance> {
  const fixtureDir = path.join(GREENFIELD_FIXTURES_DIR, taskId);
  const [metaRaw, spec] = await Promise.all([
    fs.readFile(path.join(fixtureDir, 'meta.json'), 'utf8'),
    fs.readFile(path.join(fixtureDir, 'spec.md'), 'utf8'),
  ]);
  const meta = JSON.parse(metaRaw) as GreenfieldMeta;

  const { repoDir, commit } = await withGreenfieldCacheLock(taskId, async () => {
    const canonical = await materializeScaffold(taskId);
    const privateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `artificer-greenfield-cache-${taskId}-`),
    );
    await execFileAsync('git', ['clone', '-q', canonical.repoDir, privateDir]);
    return { repoDir: privateDir, commit: canonical.commit };
  });

  return {
    instance_id: meta.task_id,
    repo: meta.task_id,
    base_commit: commit,
    problem_statement: spec.trim(),
    suite: 'greenfield',
    repository_url: repoDir,
    display_title: meta.display_title,
    test_command: meta.test_command,
  };
}

/** Loads a curated list of greenfield fixtures, preserving request order. */
export async function loadGreenfieldInstances(
  taskIds: string[],
): Promise<BenchInstance[]> {
  const found: BenchInstance[] = [];
  const missing: string[] = [];
  for (const id of taskIds) {
    try {
      found.push(await loadGreenfieldTask(id));
    } catch (err) {
      missing.push(id);
      // eslint-disable-next-line no-console
      console.warn(
        `[bench] failed to load greenfield task ${id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bench] ${missing.length} greenfield task(s) unavailable: ${missing.join(', ')}`,
    );
  }
  return found;
}
