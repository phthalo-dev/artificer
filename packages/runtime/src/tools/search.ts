import { spawn } from 'node:child_process';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { resolveScoped } from './files.js';

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  head_limit?: number;
  case_insensitive?: boolean;
}

const RG_MISSING =
  'Error: ripgrep (rg) not found on PATH. Install ripgrep (https://github.com/BurntSushi/ripgrep#installation).';

export function buildRipgrepArgs(
  input: GrepInput,
  searchPath: string,
): string[] {
  const args = ['--no-heading', '--line-number', '--color=never'];
  if (input.case_insensitive) args.push('-i');
  if (input.glob) args.push('-g', input.glob);
  args.push(input.pattern, searchPath);
  return args;
}

export function buildGlobRipgrepArgs(
  pattern: string,
  searchPath: string,
): string[] {
  return ['--files', '-g', pattern, searchPath];
}

function capLines(text: string, headLimit: number): string {
  if (!text) return '(no matches)';
  const lines = text.split('\n');
  if (lines.length <= headLimit) return text;
  return `${lines.slice(0, headLimit).join('\n')}\n... (${lines.length - headLimit} more lines)`;
}

async function runRipgrep(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('rg', args, { cwd });
    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk;
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') reject(new Error('ENOENT'));
      else reject(err);
    });
    proc.on('close', (code) => {
      if (code === 0 || code === 1) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `rg exited with code ${code}`));
    });
  });
}

export interface CreateSearchToolsOptions {
  /** When false, only the grep tool is registered (orchestrator). */
  includeGlob?: boolean;
}

export function createSearchTools(
  ctx: ToolContext,
  options: CreateSearchToolsOptions = {},
): ToolDef[] {
  const { workspaceDir } = ctx;
  const includeGlob = options.includeGlob !== false;

  async function rgMissingError(): Promise<string | null> {
    try {
      await runRipgrep(['--version'], workspaceDir);
      return null;
    } catch (err) {
      if ((err as Error).message === 'ENOENT') return RG_MISSING;
      return null;
    }
  }

  const tools: ToolDef[] = [
    {
      name: 'grep',
      description:
        'Search file contents with ripgrep. Prefer this over running grep/rg via run_shell. Paths are relative to the workspace root.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex or literal search pattern.',
          },
          path: {
            type: 'string',
            description:
              'Workspace-relative directory or file to search. Defaults to root.',
          },
          glob: {
            type: 'string',
            description: 'Optional glob filter, e.g. "*.ts".',
          },
          head_limit: {
            type: 'number',
            description: 'Max matching lines to return. Defaults to 50.',
          },
          case_insensitive: {
            type: 'boolean',
            description: 'Case-insensitive search (-i).',
          },
        },
        required: ['pattern'],
      },
      handler: async (input) => {
        const rgError = await rgMissingError();
        if (rgError) return rgError;

        const pattern = String(input.pattern ?? '').trim();
        if (!pattern) return 'Error: pattern is required.';

        const relPath = input.path ? String(input.path) : '.';
        let searchPath: string;
        try {
          searchPath = resolveScoped(workspaceDir, relPath);
        } catch (err) {
          return `Error: ${(err as Error).message}`;
        }

        const headLimit =
          typeof input.head_limit === 'number' && input.head_limit > 0
            ? input.head_limit
            : 50;

        const args = buildRipgrepArgs(
          {
            pattern,
            glob: input.glob ? String(input.glob) : undefined,
            case_insensitive: Boolean(input.case_insensitive),
          },
          searchPath,
        );

        try {
          const output = await runRipgrep(args, workspaceDir);
          return capLines(output, headLimit);
        } catch (err) {
          if ((err as Error).message === 'ENOENT') return RG_MISSING;
          return `Error: ${(err as Error).message}`;
        }
      },
    },
  ];

  if (includeGlob) {
    tools.push({
      name: 'glob',
      description:
        'Find files matching a glob pattern under the workspace using ripgrep. Paths are relative to the workspace root.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.test.ts".',
          },
          cwd: {
            type: 'string',
            description:
              'Workspace-relative directory to search from. Defaults to root.',
          },
          head_limit: {
            type: 'number',
            description: 'Max file paths to return. Defaults to 200.',
          },
        },
        required: ['pattern'],
      },
      handler: async (input) => {
        const rgError = await rgMissingError();
        if (rgError) return rgError;

        const pattern = String(input.pattern ?? '').trim();
        if (!pattern) return 'Error: pattern is required.';

        const relCwd = input.cwd ? String(input.cwd) : '.';
        let searchPath: string;
        try {
          searchPath = resolveScoped(workspaceDir, relCwd);
        } catch (err) {
          return `Error: ${(err as Error).message}`;
        }

        const headLimit =
          typeof input.head_limit === 'number' && input.head_limit > 0
            ? input.head_limit
            : 200;

        const args = buildGlobRipgrepArgs(pattern, searchPath);

        try {
          const output = await runRipgrep(args, workspaceDir);
          return capLines(output, headLimit);
        } catch (err) {
          if ((err as Error).message === 'ENOENT') return RG_MISSING;
          return `Error: ${(err as Error).message}`;
        }
      },
    });
  }

  return tools;
}
