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

const TIMEOUT_MS = 5 * 60 * 1000;
const MCP_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-status-server.mjs',
);
const MCP_SERVER_ID = 'artificer-status';

export class CursorAgentExecutor implements WorkerExecutor {
  readonly name = 'cursor-agent';

  constructor(private readonly model?: string) {}

  execute({
    context,
    workspaceDir,
    signal,
  }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
    signal?: AbortSignal;
  }): Promise<ExecutorResult> {
    const statusFile = path.join(workspaceDir, '.artificer-status.json');
    const mcpConfigDir = path.join(workspaceDir, '.cursor');
    const mcpConfigFile = path.join(mcpConfigDir, 'mcp.json');

    fs.mkdirSync(mcpConfigDir, { recursive: true });
    fs.writeFileSync(
      mcpConfigFile,
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_ID]: {
            command: process.execPath,
            args: [MCP_SERVER, statusFile],
          },
        },
      }),
    );

    // Clean up any status file from a previous run
    fs.rmSync(statusFile, { force: true });

    return new Promise((resolve, reject) => {
      const args = [
        'agent',
        '--print',
        '--trust',
        '--yolo',
        '--approve-mcps',
        '--workspace',
        workspaceDir,
      ];
      if (this.model) args.push('--model', this.model);
      args.push(context);

      const child = spawn('cursor', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('cursor agent timed out'));
      }, TIMEOUT_MS);
      const onAbort = () => {
        child.kill('SIGTERM');
        reject(new Error('cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();

      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const text = Buffer.concat(stdout).toString('utf-8').trim();

        // Read MCP-reported tool result if a tool was called
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
              `cursor agent exited with code ${code}: ${errText || text}`,
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
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
    });
  }
}
