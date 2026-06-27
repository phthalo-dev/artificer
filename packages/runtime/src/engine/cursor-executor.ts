import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunRecord } from '../storage/types.js';
import type { ExecutorResult, WorkerExecutor } from './executor.js';
import type { WorkerStatus } from './worker-report.js';

const TIMEOUT_MS = 5 * 60 * 1000;
const MCP_SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp-status-server.mjs');
const MCP_SERVER_ID = 'artificer-status';

export class CursorAgentExecutor implements WorkerExecutor {
  readonly name = 'cursor-agent';

  constructor(private readonly model?: string) {}

  execute({ context, workspaceDir }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
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
        'agent', '--print', '--trust', '--yolo', '--approve-mcps',
        '--workspace', workspaceDir,
      ];
      if (this.model) args.push('--model', this.model);
      args.push(context);

      const child = spawn('cursor', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('cursor agent timed out'));
      }, TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timer);
        const text = Buffer.concat(stdout).toString('utf-8').trim();

        // Read MCP-reported status if the tool was called
        let workerStatus: WorkerStatus | undefined;
        let workerSummary: string | undefined;
        let workerFollowUps: string | undefined;
        try {
          if (fs.existsSync(statusFile)) {
            const raw = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as Record<string, unknown>;
            workerStatus = raw.status as WorkerStatus | undefined;
            workerSummary = raw.summary as string | undefined;
            workerFollowUps = raw.followUps as string | undefined;
          }
        } catch { /* ignore malformed status file */ }

        if (code !== 0) {
          const errText = Buffer.concat(stderr).toString('utf-8').trim();
          reject(new Error(`cursor agent exited with code ${code}: ${errText || text}`));
        } else {
          resolve({
            text: text || '(no output)',
            usage: { inputTokens: 0, outputTokens: 0 },
            workerStatus,
            workerSummary,
            workerFollowUps,
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
