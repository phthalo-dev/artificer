import fs from 'node:fs/promises';
import path from 'node:path';

export function evalResultsRoot(execDir: string): string {
  return path.join(execDir, 'evals');
}

export function newEvalRunDir(execDir: string, suiteId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(evalResultsRoot(execDir), 'runs', `${stamp}-${suiteId}`);
}

export async function updateLatestSymlink(
  execDir: string,
  runDir: string,
): Promise<void> {
  const root = evalResultsRoot(execDir);
  const link = path.join(root, 'latest');
  await fs.mkdir(root, { recursive: true });
  await fs.rm(link, { recursive: true, force: true });
  await fs.symlink(runDir, link, 'dir');
}
