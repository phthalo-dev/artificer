import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunRecord } from '../storage/types.js';
import type { ExecutorResult, WorkerExecutor } from './executor.js';
import {
  abortAgent,
  executorStateDir,
  killProcessGroup,
  readExecutorStatus,
} from './executor-files.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const MCP_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-status-server.mjs',
);

export class ClaudeCodeExecutor implements WorkerExecutor {
  readonly name = 'claude-code';
  readonly resumesSession = true;

  constructor(private readonly model?: string) {}

  execute({
    context,
    workspaceDir,
    sessionId,
    signal,
    outputFormat,
  }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
    sessionId?: string;
    signal?: AbortSignal;
    outputFormat?: 'text' | 'json';
  }): Promise<ExecutorResult> {
    const stateDir = executorStateDir(workspaceDir);
    const statusFile = path.join(stateDir, '.artificer-status.json');
    const mcpConfigFile = path.join(stateDir, '.artificer-mcp.json');

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

    return new Promise((resolve, reject) => {
      const args = [
        '--print',
        '--dangerously-skip-permissions',
        '--mcp-config',
        mcpConfigFile,
      ];
      if (this.model) args.push('--model', this.model);
      if (sessionId) args.push('--resume', sessionId);
      if (outputFormat === 'json') args.push('--output-format', 'json');

      const child = spawn('claude', args, {
        cwd: workspaceDir,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin.write(context);
      child.stdin.end();

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      const timer = setTimeout(() => {
        killProcessGroup(child, 'SIGKILL');
        reject(new Error('claude code agent timed out'));
      }, TIMEOUT_MS);
      const stop = abortAgent(child, signal, reject);

      child.on('close', (code) => {
        clearTimeout(timer);
        stop();
        const stdoutText = Buffer.concat(stdout).toString('utf-8').trim();
        let text = stdoutText;
        let resultSessionId: string | undefined;
        if (outputFormat === 'json') {
          try {
            const parsed = JSON.parse(stdoutText) as Record<string, unknown>;
            text = typeof parsed.result === 'string' ? parsed.result : '';
            resultSessionId =
              typeof parsed.session_id === 'string'
                ? parsed.session_id
                : undefined;
          } catch {
            text = stdoutText;
          }
        }

        if (code !== 0) {
          const errText = Buffer.concat(stderr).toString('utf-8').trim();
          reject(
            new Error(
              `claude code agent exited with code ${code}: ${errText || text}`,
            ),
          );
        } else {
          resolve({
            text: text || '(no output)',
            sessionId: resultSessionId,
            usage: { inputTokens: 0, outputTokens: 0 },
            ...readExecutorStatus(statusFile),
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        stop();
        reject(err);
      });
    });
  }
}
