import type { RunRecord } from '../storage/types.js';

export interface ExecutorResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface WorkerExecutor {
  execute(opts: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
  }): Promise<ExecutorResult>;
}
