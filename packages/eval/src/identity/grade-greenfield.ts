import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { overlayHiddenFixture } from './greenfield-fixture.js';

const execFileAsync = promisify(execFile);
const DEFAULT_GRADE_TIMEOUT_MS = 120_000;

export interface GradeGreenfieldPatchOptions {
  repoDir: string;
  patch: string;
  hiddenDir: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

/** Applies an extracted patch to a clean fixture and runs its hidden tests. */
export async function gradeGreenfieldPatch(
  options: GradeGreenfieldPatchOptions,
): Promise<boolean> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-greenfield-grade-'),
  );
  const workdir = path.join(rootDir, 'repo');

  try {
    await execFileAsync('git', ['clone', '-q', options.repoDir, workdir]);
    if (options.patch.trim()) {
      const patchFile = path.join(rootDir, 'model.patch');
      await fs.writeFile(patchFile, options.patch, 'utf8');
      await execFileAsync('git', ['apply', '--whitespace=nowarn', patchFile], {
        cwd: workdir,
      });
    }

    await overlayHiddenFixture(options.hiddenDir, workdir);
    const gradeDir = resolveGradeDir(workdir, options.cwd);
    const { NODE_TEST_CONTEXT: _nodeTestContext, ...env } = process.env;
    const { stdout, stderr } = await execFileAsync(
      'sh',
      ['-c', options.command],
      {
        cwd: gradeDir,
        env,
        timeout: options.timeoutMs ?? DEFAULT_GRADE_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return nodeTestCount(`${stdout}\n${stderr}`) > 0;
  } catch {
    return false;
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  }
}

function resolveGradeDir(repoDir: string, relativeCwd?: string): string {
  if (!relativeCwd) return repoDir;
  const resolved = path.resolve(repoDir, relativeCwd);
  const relative = path.relative(repoDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`shell grader cwd escapes fixture repo: ${relativeCwd}`);
  }
  return resolved;
}

/**
 * Count tests reported by `node --test`. Spec reporter prints `ℹ tests N`;
 * TAP (the default when stdout is not a TTY, e.g. GitHub Actions) prints
 * `# tests N`.
 */
export function nodeTestCount(rawOutput: string): number {
  // Forced-color runs (FORCE_COLOR=1, e.g. under `vp run` in CI) wrap the
  // summary in ANSI escapes, which would break the line-anchored patterns.
  // eslint-disable-next-line no-control-regex
  const output = rawOutput.replace(/\u001b\[[0-9;]*m/g, '');
  const spec = /^ℹ tests (\d+)\s*$/m.exec(output);
  if (spec) return Number(spec[1]);
  const tap = /^# tests (\d+)\s*$/m.exec(output);
  if (tap) return Number(tap[1]);
  const plan = /^1\.\.(\d+)\s*$/m.exec(output);
  if (plan) return Number(plan[1]);
  return 0;
}
