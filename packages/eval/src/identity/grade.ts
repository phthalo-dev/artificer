import fs from 'node:fs/promises';
import path from 'node:path';

/** True when at least one outbound message contains the configured pattern. */
export function gradeMessageContains(
  outboundMessages: string[],
  pattern: string,
): boolean {
  return outboundMessages.some((message) => message.includes(pattern));
}

/** True when the workstream reached one of the configured statuses. */
export function gradeWorkstreamStatus(
  status: string,
  expect: string[],
): boolean {
  return expect.includes(status);
}

/**
 * True when `relativePath` exists under `workspaceDir` (file or directory).
 * Rejects paths that escape the workspace (identity-dir checks are never valid).
 */
export async function gradeFileExists(
  workspaceDir: string,
  relativePath: string,
): Promise<boolean> {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const resolved = path.resolve(workspaceDir, relativePath);
  const relative = path.relative(workspaceDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try {
    await fs.access(resolved);
    return true;
  } catch {
    return false;
  }
}
