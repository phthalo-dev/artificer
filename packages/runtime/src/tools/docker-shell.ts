import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DockerBenchManifest } from './docker-bench-manifest.js';
import { syncHostRepoToContainer } from './docker-bench-manifest.js';
import {
  formatDockerExecFailure,
  rewriteDockerShellCommand,
} from './docker-path.js';

const exec = promisify(execFile);

const NOISE_ENV: Record<string, string> = {
  PAGER: 'cat',
  MANPAGER: 'cat',
  LESS: '-R',
  PIP_PROGRESS_BAR: 'off',
  TQDM_DISABLE: '1',
};

export interface DockerShellResult {
  output: string;
  timedOut: boolean;
}

/**
 * Execute a command inside a bench Docker container (Harbor-style evaluator
 * image). Used when RUNTIME_DOCKER_CONTAINER_ID is set.
 */
export async function runDockerShellCommand(opts: {
  command: string;
  docker: DockerBenchManifest;
  timeoutMs: number;
  extraEnv?: NodeJS.ProcessEnv;
}): Promise<DockerShellResult> {
  const { containerId, workDir } = opts.docker;
  await syncHostRepoToContainer(opts.docker);
  const command = rewriteDockerShellCommand(opts.command);

  const envArgs: string[] = [];
  for (const [key, value] of Object.entries({ ...NOISE_ENV, ...opts.extraEnv })) {
    if (value !== undefined) envArgs.push('-e', `${key}=${value}`);
  }

  const args = [
    'exec',
    '-w',
    workDir,
    ...envArgs,
    containerId,
    'bash',
    '-lc',
    command,
  ];

  try {
    const { stdout, stderr } = await exec('docker', args, {
      timeout: opts.timeoutMs,
      maxBuffer: 1024 * 1024 * 10,
      killSignal: 'SIGKILL',
    });
    const parts = [stdout, stderr].filter(Boolean).join('\n').trim();
    return { output: parts || '(no output)', timedOut: false };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      message: string;
      killed?: boolean;
      signal?: string;
    };
    const partial = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    if (e.killed || e.signal === 'SIGKILL') {
      const marker = `Command timed out after ${opts.timeoutMs}ms and was killed.`;
      return { output: partial ? `${marker}\n${partial}` : marker, timedOut: true };
    }
    return { output: formatDockerExecFailure(e), timedOut: false };
  }
}
