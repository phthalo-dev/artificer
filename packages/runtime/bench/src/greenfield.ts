import fs from 'node:fs/promises';
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

/**
 * Materializes a fixture's scaffold/ directory into a fresh local git repo the
 * bench driver can `git clone` like any other instance, and commits it so
 * there is a base_commit to check out. Re-materializes on every call so a
 * fixture edit is always picked up (cheap: fixtures are a handful of files).
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

/** Loads one greenfield fixture into the shared BenchInstance shape. */
export async function loadGreenfieldTask(taskId: string): Promise<BenchInstance> {
  const fixtureDir = path.join(GREENFIELD_FIXTURES_DIR, taskId);
  const [metaRaw, spec] = await Promise.all([
    fs.readFile(path.join(fixtureDir, 'meta.json'), 'utf8'),
    fs.readFile(path.join(fixtureDir, 'spec.md'), 'utf8'),
  ]);
  const meta = JSON.parse(metaRaw) as GreenfieldMeta;
  const { repoDir, commit } = await materializeScaffold(taskId);

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
