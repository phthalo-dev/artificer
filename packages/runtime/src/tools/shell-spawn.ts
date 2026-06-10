import { spawn } from 'node:child_process';
import type { ShellRunResult } from './shell.js';

const DEFAULT_TIMEOUT_MS = 1000 * 60 * 5;
const MAX_BUFFER = 1024 * 1024 * 10;

const SHELL_NOISE_ENV: NodeJS.ProcessEnv = {
  PAGER: 'cat',
  MANPAGER: 'cat',
  LESS: '-R',
  PIP_PROGRESS_BAR: 'off',
  TQDM_DISABLE: '1',
};

/**
 * Kill a detached process group on Unix. Falls back to killing the single
 * process when the group is already gone.
 */
export function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }
}

function appendChunk(current: string, chunk: Buffer): string {
  const next = current + chunk.toString();
  return next.length > MAX_BUFFER ? next.slice(0, MAX_BUFFER) : next;
}

function formatTimedOutOutput(partial: string, timeoutMs: number): ShellRunResult {
  const marker = `Command timed out after ${timeoutMs}ms and was killed.`;
  return { output: partial ? `${marker}\n${partial}` : marker, timedOut: true };
}

/**
 * Run a shell command via spawn with process-group kill on timeout (Unix).
 *
 * On Unix, spawns `bash -lc` detached so the child becomes a process-group
 * leader; timeout uses `process.kill(-pid, 'SIGKILL')` to stop the whole tree.
 *
 * On Windows, spawns `cmd /c` without a process group — only the direct child
 * is killed on timeout (documented limitation).
 */
export async function runShellCommandSpawn(opts: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ShellRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = { ...SHELL_NOISE_ENV, ...opts.env };

  if (process.platform === 'win32') {
    return runShellCommandSpawnWindows({ ...opts, env, timeoutMs });
  }

  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', opts.command], {
      cwd: opts.cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const pid = child.pid;
    if (pid === undefined) {
      resolve({ output: 'Command failed:\nFailed to spawn process', timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendChunk(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendChunk(stderr, chunk);
    });

    const finish = (result: ShellRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const killForTimeout = () => {
      if (settled) return;
      timedOut = true;
      killProcessGroup(pid);
    };

    const timer = setTimeout(killForTimeout, timeoutMs);

    const onAbort = () => {
      timedOut = true;
      killProcessGroup(pid);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('close', (code, signal) => {
      const partial = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (timedOut) {
        finish(formatTimedOutOutput(partial, timeoutMs));
        return;
      }
      if (code === 0) {
        finish({ output: partial || '(no output)', timedOut: false });
        return;
      }
      const detail =
        partial ||
        (signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`);
      finish({ output: `Command failed:\n${detail}`, timedOut: false });
    });

    child.on('error', (err) => {
      finish({ output: `Command failed:\n${err.message}`, timedOut: false });
    });
  });
}

/** Windows fallback — no process-group kill; only the direct child is stopped. */
async function runShellCommandSpawnWindows(opts: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ShellRunResult> {
  return new Promise((resolve) => {
    const child = spawn('cmd', ['/c', opts.command], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendChunk(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendChunk(stderr, chunk);
    });

    const finish = (result: ShellRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const killForTimeout = () => {
      if (settled || child.pid === undefined) return;
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // Process already exited.
      }
    };

    const timer = setTimeout(killForTimeout, opts.timeoutMs);

    const onAbort = () => {
      timedOut = true;
      killForTimeout();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('close', (code, signal) => {
      const partial = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (timedOut) {
        finish(formatTimedOutOutput(partial, opts.timeoutMs));
        return;
      }
      if (code === 0) {
        finish({ output: partial || '(no output)', timedOut: false });
        return;
      }
      const detail =
        partial ||
        (signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`);
      finish({ output: `Command failed:\n${detail}`, timedOut: false });
    });

    child.on('error', (err) => {
      finish({ output: `Command failed:\n${err.message}`, timedOut: false });
    });
  });
}
