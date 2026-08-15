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

const TIMEOUT_MS = 10 * 60 * 1000;
const MCP_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-status-server.mjs',
);
const MCP_SERVER_ID = 'artificer-status';

export class OpencodeExecutor implements WorkerExecutor {
  readonly name = 'opencode';

  constructor(private readonly model?: string) {}

  execute({
    context,
    workspaceDir,
  }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
  }): Promise<ExecutorResult> {
    const statusFile = path.join(workspaceDir, '.artificer-status.json');
    // opencode discovers MCP servers from a project-level opencode.json
    // (walking up from cwd) — there is no --mcp-config flag, so this must
    // live at the workspace root under opencode's own config file name.
    const mcpConfigFile = path.join(workspaceDir, 'opencode.json');

    fs.writeFileSync(
      mcpConfigFile,
      JSON.stringify({
        mcp: {
          [MCP_SERVER_ID]: {
            type: 'local',
            command: [process.execPath, MCP_SERVER, statusFile],
            enabled: true,
          },
        },
      }),
    );

    // Clean up any status file from a previous run
    fs.rmSync(statusFile, { force: true });

    return new Promise((resolve, reject) => {
      const args = [
        'run',
        context,
        '--dangerously-skip-permissions',
        '--dir',
        workspaceDir,
      ];
      if (this.model) args.push('--model', this.model);

      const child = spawn('opencode', args, {
        cwd: workspaceDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('opencode agent timed out'));
      }, TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timer);
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
              `opencode agent exited with code ${code}: ${errText || text}`,
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
