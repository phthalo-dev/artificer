import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Directory for executor-generated state (status file, MCP config, published
 * artifacts). It lives outside the workspace so a run never dirties a checkout.
 */
export function executorStateDir(workspaceDir: string): string {
  const key = createHash('sha256')
    .update(path.resolve(workspaceDir))
    .digest('hex')
    .slice(0, 16);
  const dir = path.join(os.tmpdir(), 'artificer-executor', key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function gitOutput(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function realpath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/** Add `relPath` to the repo's info/exclude when `workspaceDir` is a repo root. */
function excludeFromRepo(workspaceDir: string, relPath: string): void {
  const top = gitOutput(workspaceDir, ['rev-parse', '--show-toplevel']);
  if (!top || realpath(top) !== realpath(workspaceDir)) return;
  const excludeFile = gitOutput(workspaceDir, [
    'rev-parse',
    '--git-path',
    'info/exclude',
  ]);
  if (!excludeFile) return;
  const resolved = path.resolve(workspaceDir, excludeFile);
  const pattern = `/${relPath.split(path.sep).join('/')}`;
  let existing = '';
  try {
    existing = fs.readFileSync(resolved, 'utf-8');
  } catch {
    /* no exclude file yet */
  }
  if (existing.split('\n').some((line) => line.trim() === pattern)) return;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(resolved, `${prefix}${pattern}\n`);
}

/**
 * Write a config file a tool only reads from its project directory. Any file
 * already at that path is kept and put back by the returned restore function,
 * and the generated path is excluded from git so it never shows as untracked.
 */
export function writeProjectFile(
  workspaceDir: string,
  relPath: string,
  content: string,
): () => void {
  const file = path.join(workspaceDir, relPath);
  let previous: Buffer | undefined;
  try {
    previous = fs.readFileSync(file);
  } catch {
    previous = undefined;
  }
  const createdDirs: string[] = [];
  for (
    let dir = path.dirname(file);
    dir !== workspaceDir && !fs.existsSync(dir);
    dir = path.dirname(dir)
  ) {
    createdDirs.push(dir);
  }
  excludeFromRepo(workspaceDir, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    try {
      if (previous !== undefined) {
        fs.writeFileSync(file, previous);
        return;
      }
      fs.rmSync(file, { force: true });
      for (const dir of createdDirs) {
        try {
          fs.rmdirSync(dir);
        } catch {
          break;
        }
      }
    } catch (error) {
      console.error(`[executor] failed to restore ${file}:`, error);
    }
  };
}
