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

async function run(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      env,
      timeout: 1000 * 60 * 10,
      maxBuffer: 1024 * 1024 * 20,
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
}

export function createGitTools(ctx: ToolContext): ToolDef[] {
  const { workspaceDir } = ctx;
  const env = buildGitEnv(ctx.engine.config.github, process.env, workspaceDir);

  return [
    {
      name: 'git',
      description:
        'Run a git command in the workspace (or a subdirectory). Provide arguments without the leading "git", e.g. "status" or "commit -m \\"msg\\"".',
      inputSchema: {
        type: 'object',
        properties: {
          args: {
            type: 'string',
            description: 'Arguments passed to git, without the leading "git".',
          },
          cwd: {
            type: 'string',
            description: 'Optional workspace-relative directory (e.g. a clone).',
          },
        },
        required: ['args'],
      },
      handler: async (input) => {
        const cwd = input.cwd
          ? `${workspaceDir}/${String(input.cwd)}`
          : workspaceDir;
        return run(`git ${String(input.args)}`, cwd, env);
      },
    },
    {
      name: 'gh',
      description:
        'Run a GitHub CLI (gh) command in the workspace. Provide arguments without the leading "gh", e.g. "pr create --fill".',
      inputSchema: {
        type: 'object',
        properties: {
          args: {
            type: 'string',
            description: 'Arguments passed to gh, without the leading "gh".',
          },
          cwd: {
            type: 'string',
            description: 'Optional workspace-relative directory (e.g. a clone).',
          },
        },
        required: ['args'],
      },
      handler: async (input) => {
        const cwd = input.cwd
          ? `${workspaceDir}/${String(input.cwd)}`
          : workspaceDir;
        return run(`gh ${String(input.args)}`, cwd, env);
      },
    },
  ];
}
