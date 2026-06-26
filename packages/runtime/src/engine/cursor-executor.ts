import { spawn } from 'node:child_process';
import type { RunRecord } from '../storage/types.js';
import type { ExecutorResult, WorkerExecutor } from './executor.js';

const TIMEOUT_MS = 5 * 60 * 1000;

export class CursorAgentExecutor implements WorkerExecutor {
  constructor(private readonly model?: string) {}

  execute({ context, workspaceDir }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
  }): Promise<ExecutorResult> {
    return new Promise((resolve, reject) => {
      const args = ['agent', '--print', '--trust', '--yolo', '--workspace', workspaceDir];
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
        if (code !== 0) {
          const errText = Buffer.concat(stderr).toString('utf-8').trim();
          reject(new Error(`cursor agent exited with code ${code}: ${errText || text}`));
        } else {
          resolve({ text: text || '(no output)', usage: { inputTokens: 0, outputTokens: 0 } });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
