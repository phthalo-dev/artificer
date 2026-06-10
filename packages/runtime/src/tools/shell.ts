import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { readDockerBenchManifest } from './docker-bench-manifest.js';
import { runDockerShellCommand } from './docker-shell.js';
import { checkGitCloneInWorkspace, checkReviewerWrite } from './shell-policy.js';
import { buildGitEnv } from './git-env.js';
import { elideOutput } from './output-elision.js';
import { runShellCommandSpawn } from './shell-spawn.js';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 1000 * 60 * 5;

const SHELL_NOISE_ENV: NodeJS.ProcessEnv = {
  PAGER: 'cat',
  MANPAGER: 'cat',
  LESS: '-R',
  PIP_PROGRESS_BAR: 'off',
  TQDM_DISABLE: '1',
};

function formatShellOutput(text: string): string {
  return elideOutput(text);
}

export interface ShellRunResult {
  output: string;
  timedOut: boolean;
}

/**
 * Run a shell command with a hard timeout. On timeout the child is sent
 * SIGKILL (not the default SIGTERM, which a hung or signal-ignoring process can
 * swallow), guaranteeing the command cannot burn the whole run budget. The
 * returned output carries an explicit marker so the model learns it hung.
 */
export async function runShellCommand(opts: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<ShellRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const { stdout, stderr } = await execAsync(opts.command, {
      cwd: opts.cwd,
      env: { ...SHELL_NOISE_ENV, ...opts.env },
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024 * 10,
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
      const marker = `Command timed out after ${timeoutMs}ms and was killed.`;
      return { output: partial ? `${marker}\n${partial}` : marker, timedOut: true };
    }
    const detail = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
    return { output: `Command failed:\n${detail}`, timedOut: false };
  }
}

export function createShellTool(ctx: ToolContext): ToolDef[] {
  const { workspaceDir } = ctx;
  const env = buildGitEnv(ctx.engine.config.github);

  return [
    {
      name: 'run_shell',
      description:
        'Run a shell command. The working directory defaults to the workspace root. Use this for builds, tests, and any command-line work.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
          cwd: {
            type: 'string',
            description:
              'Optional workspace-relative working directory for the command.',
          },
        },
        required: ['command'],
      },
      handler: async (input) => {
        const cwd = input.cwd
          ? `${workspaceDir}/${String(input.cwd)}`
          : workspaceDir;
        const command = String(input.command);
        const cloneCheck = checkGitCloneInWorkspace(command, cwd, workspaceDir);
        if (!cloneCheck.allowed) {
          return `Error: ${cloneCheck.reason}`;
        }
        const writeCheck = checkReviewerWrite(command, ctx.run.role);
        if (!writeCheck.allowed) {
          return `Error: ${writeCheck.reason}`;
        }
        const dataDir = path.resolve(ctx.engine.config.dataDir);
        const dockerManifest = await readDockerBenchManifest(dataDir);
        const timeoutMs = DEFAULT_TIMEOUT_MS;
        const useProcessGroup =
          ctx.engine.config.shellUseProcessGroup && process.platform !== 'win32';
        const runShell = useProcessGroup ? runShellCommandSpawn : runShellCommand;
        const { output } = dockerManifest
          ? await runDockerShellCommand({
              command,
              docker: dockerManifest,
              timeoutMs,
              extraEnv: env,
            })
          : await runShell({ command, cwd, env, timeoutMs });
        return formatShellOutput(output);
      },
    },
  ];
}
