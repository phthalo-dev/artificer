import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MaterializedGreenfieldFixture {
  repoDir: string;
  baseCommit: string;
  cleanup: () => Promise<void>;
}

/** Recursively copies a fixture tree into a workspace. */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(source, target);
    } else {
      await fs.copyFile(source, target);
    }
  }
}

/** Copies fixture/ into an isolated git repository for the runtime to clone. */
export async function materializeGreenfieldFixture(
  fixtureDir: string,
): Promise<MaterializedGreenfieldFixture> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-greenfield-fixture-'),
  );
  const repoDir = path.join(rootDir, 'repo');

  try {
    await copyDir(fixtureDir, repoDir);
    await git(repoDir, ['init', '-q']);
    await git(repoDir, ['config', 'user.email', 'eval@artificer.local']);
    await git(repoDir, ['config', 'user.name', 'artificer-eval']);
    await git(repoDir, ['add', '-A']);
    await git(repoDir, ['commit', '-q', '-m', 'fixture']);
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

/**
 * Overlays hidden grader files at grade time. A colliding top-level tree is
 * replaced first so agent-authored tests cannot remain alongside hidden tests.
 */
export async function overlayHiddenFixture(
  hiddenDir: string,
  repoDir: string,
): Promise<void> {
  const entries = await fs.readdir(hiddenDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(hiddenDir, entry.name);
    const target = path.join(repoDir, entry.name);
    await fs.rm(target, { recursive: true, force: true });
    if (entry.isDirectory()) {
      await copyDir(source, target);
    } else {
      await fs.copyFile(source, target);
    }
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}
