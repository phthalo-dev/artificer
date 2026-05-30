import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { buildGitEnv } from './git-env.js';

const execAsync = promisify(exec);

const MAX_OUTPUT = 16_000;

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n... (output truncated)`;
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
        try {
          const { stdout, stderr } = await execAsync(String(input.command), {
            cwd,
            env,
            timeout: 1000 * 60 * 5,
            maxBuffer: 1024 * 1024 * 10,
          });
          const parts = [stdout, stderr].filter(Boolean).join('\n').trim();
          return truncate(parts || '(no output)');
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string; message: string };
          const detail = [e.stdout, e.stderr, e.message]
            .filter(Boolean)
            .join('\n')
            .trim();
          return truncate(`Command failed:\n${detail}`);
        }
      },
    },
  ];
}
