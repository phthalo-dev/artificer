import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunRecord } from '../storage/types.js';
import type {
  ExecutorReview,
  ExecutorResult,
  WorkerExecutor,
} from './executor.js';
import type { WorkerStatus } from './worker-report.js';

const MCP_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-status-server.mjs',
);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface CliExecutorOptions {
  command: string;
  args: string[];
  promptMode: 'stdin' | 'arg';
  model?: string;
  timeout?: number;
  /** Workspace-relative path for the MCP config file. Defaults to `.artificer-mcp.json`. */
  mcpConfigPath?: string;
}

export class CliExecutor implements WorkerExecutor {
  readonly name: string;

  constructor(private readonly opts: CliExecutorOptions) {
    this.name = `cli:${opts.command}`;
  }

  execute({
    context,
    workspaceDir,
  }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
  }): Promise<ExecutorResult> {
    const statusFile = path.join(workspaceDir, '.artificer-status.json');
    const mcpConfigFile = path.join(
      workspaceDir,
      this.opts.mcpConfigPath ?? '.artificer-mcp.json',
    );

    fs.mkdirSync(path.dirname(mcpConfigFile), { recursive: true });
    fs.writeFileSync(
      mcpConfigFile,
      JSON.stringify({
        mcpServers: {
          'artificer-status': {
            command: process.execPath,
            args: [MCP_SERVER, statusFile],
          },
        },
      }),
    );
    fs.rmSync(statusFile, { force: true });

    const resolvedArgs = resolveArgs(this.opts.args, {
      workspaceDir,
      mcpConfig: mcpConfigFile,
      model: this.opts.model,
      prompt: this.opts.promptMode === 'arg' ? context : undefined,
    });

    const timeoutMs = this.opts.timeout ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.command, resolvedArgs, {
        cwd: workspaceDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (this.opts.promptMode === 'stdin') {
        child.stdin.write(context);
      }
      child.stdin.end();

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${this.opts.command} timed out`));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        const text = Buffer.concat(stdout).toString('utf-8').trim();

        let workerStatus: WorkerStatus | undefined;
        let workerSummary: string | undefined;
        let workerFollowUps: string | undefined;
        let review: ExecutorReview | undefined;
        try {
          if (fs.existsSync(statusFile)) {
            const raw = JSON.parse(
              fs.readFileSync(statusFile, 'utf-8'),
            ) as Record<string, unknown>;
            if (raw.tool === 'submit_review') {
              review = {
                target: String(raw.target ?? 'work'),
                notes: String(raw.notes ?? ''),
                approved: Boolean(raw.approved),
                stage: (raw.stage as 'plan' | 'work' | undefined) ?? 'work',
                severity: raw.severity as
                  | ExecutorReview['severity']
                  | undefined,
              };
            } else {
              workerStatus = raw.status as WorkerStatus | undefined;
              workerSummary = raw.summary as string | undefined;
              workerFollowUps = raw.followUps as string | undefined;
            }
          }
        } catch {
          /* ignore malformed status file */
        }

        if (code !== 0) {
          const errText = Buffer.concat(stderr).toString('utf-8').trim();
          reject(
            new Error(
              `${this.opts.command} exited with code ${code}: ${errText || text}`,
            ),
          );
        } else {
          resolve({
            text: text || '(no output)',
            usage: { inputTokens: 0, outputTokens: 0 },
            workerStatus,
            workerSummary,
            workerFollowUps,
            review,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}

/**
 * Expands an args template, substituting {workspaceDir}, {mcpConfig}, {model}, and {prompt}.
 * When an arg is a bare placeholder (e.g. "{model}") and the value is empty, that arg is
 * dropped along with the preceding flag if it starts with "-".
 */
export function resolveArgs(
  template: string[],
  values: {
    workspaceDir: string;
    mcpConfig: string;
    model?: string;
    prompt?: string;
  },
): string[] {
  const lookup: Record<string, string | undefined> = {
    workspaceDir: values.workspaceDir,
    mcpConfig: values.mcpConfig,
    model: values.model,
    prompt: values.prompt,
  };

  const result: string[] = [];
  for (const arg of template) {
    const pureMatch = /^\{(\w+)\}$/.exec(arg);
    if (pureMatch) {
      const value = lookup[pureMatch[1]!];
      if (!value) {
        if (result.length > 0 && result[result.length - 1]!.startsWith('-')) {
          result.pop();
        }
        continue;
      }
      result.push(value);
    } else {
      result.push(
        arg.replace(/\{(\w+)\}/g, (_, key: string) => lookup[key] ?? ''),
      );
    }
  }
  return result;
}
