import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExecutorResult, ExecutorReview } from './executor.js';
import type { WorkerStatus } from './worker-report.js';

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

function appendExcludePattern(file: string, pattern: string): void {
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf-8');
  } catch {
    /* no exclude file yet */
  }
  if (existing.split('\n').some((line) => line.trim() === pattern)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${prefix}${pattern}\n`);
}

function excludeLinkedWorktree(workspaceDir: string, pattern: string): void {
  const excludeFile = path.join(executorStateDir(workspaceDir), 'exclude');
  execFileSync(
    'git',
    ['-C', workspaceDir, 'config', 'extensions.worktreeConfig', 'true'],
    { stdio: 'ignore' },
  );
  const current = gitOutput(workspaceDir, [
    'config',
    '--worktree',
    '--get',
    'core.excludesFile',
  ]);
  if (current) {
    appendExcludePattern(path.resolve(workspaceDir, current), pattern);
    return;
  }
  appendExcludePattern(excludeFile, pattern);
  execFileSync(
    'git',
    [
      '-C',
      workspaceDir,
      'config',
      '--worktree',
      'core.excludesFile',
      excludeFile,
    ],
    { stdio: 'ignore' },
  );
}

/** Add `relPath` to the repo's info/exclude when `workspaceDir` is a repo root. */
function excludeFromRepo(workspaceDir: string, relPath: string): void {
  const top = gitOutput(workspaceDir, ['rev-parse', '--show-toplevel']);
  if (!top || realpath(top) !== realpath(workspaceDir)) return;
  const pattern = `/${relPath.split(path.sep).join('/')}`;
  let gitStat: fs.Stats;
  try {
    gitStat = fs.statSync(path.join(workspaceDir, '.git'));
  } catch {
    return;
  }
  // info/exclude is shared by every worktree. A linked worktree gets its own
  // excludes file so one run does not hide paths in the others.
  if (gitStat.isFile()) {
    excludeLinkedWorktree(workspaceDir, pattern);
    return;
  }
  const excludeFile = gitOutput(workspaceDir, [
    'rev-parse',
    '--git-path',
    'info/exclude',
  ]);
  if (!excludeFile) return;
  appendExcludePattern(path.resolve(workspaceDir, excludeFile), pattern);
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

const KILL_ESCALATE_MS = 1_000;

/**
 * Detached agents are their own session, so a runtime Ctrl+C or SIGTERM does
 * not take them with it. Track the group leaders and kill them on the way out.
 */
const agentGroups = new Set<number>();
let reaperInstalled = false;

function installAgentReaper(): void {
  if (reaperInstalled) return;
  reaperInstalled = true;
  process.on('exit', reapAgentGroups);
  process.once('SIGINT', () => {
    reapAgentGroups();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    reapAgentGroups();
    process.exit(143);
  });
}

/** SIGKILL every agent process group still running. */
export function reapAgentGroups(): void {
  for (const pid of agentGroups) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  agentGroups.clear();
}

function trackAgentProcess(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  installAgentReaper();
  agentGroups.add(pid);
  child.on('exit', () => {
    agentGroups.delete(pid);
  });
}

/** Signal an agent and the processes it spawned in its own group. */
export function killProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already exited */
    }
  }
}

/**
 * Reject with `cancelled` and stop the agent's process group. The child must
 * be spawned with `detached: true` so the negative pid is its group, not ours.
 * Returns a cleanup function for the close/error handlers. After an abort,
 * that cleanup SIGKILLs the group: the parent CLI often exits on SIGTERM and
 * would otherwise cancel the follow-up kill, leaving children that ignore
 * SIGTERM running.
 */
export function abortAgent(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  reject: (error: Error) => void,
): () => void {
  trackAgentProcess(child);
  let aborted = false;
  let escalate: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    aborted = true;
    killProcessGroup(child, 'SIGTERM');
    escalate = setTimeout(
      () => killProcessGroup(child, 'SIGKILL'),
      KILL_ESCALATE_MS,
    );
    escalate.unref();
    reject(new Error('cancelled'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return () => {
    signal?.removeEventListener('abort', onAbort);
    if (!aborted) return;
    if (escalate) clearTimeout(escalate);
    killProcessGroup(child, 'SIGKILL');
  };
}

/**
 * Parse the status file written by the MCP status server (`report_status` or
 * `submit_review`). Returns `{}` when the file is missing or malformed.
 */
export function readExecutorStatus(
  statusFile: string,
): Pick<
  ExecutorResult,
  'workerStatus' | 'workerSummary' | 'workerFollowUps' | 'review'
> {
  try {
    if (!fs.existsSync(statusFile)) return {};
    const raw = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as Record<
      string,
      unknown
    >;
    if (raw.tool === 'submit_review') {
      return {
        review: {
          target: String(raw.target ?? 'work'),
          notes: String(raw.notes ?? ''),
          approved: Boolean(raw.approved),
          stage: (raw.stage as 'plan' | 'work' | undefined) ?? 'work',
          severity: raw.severity as ExecutorReview['severity'] | undefined,
        },
      };
    }
    return {
      workerStatus: raw.status as WorkerStatus | undefined,
      workerSummary: raw.summary as string | undefined,
      workerFollowUps: raw.followUps as string | undefined,
    };
  } catch {
    return {};
  }
}
