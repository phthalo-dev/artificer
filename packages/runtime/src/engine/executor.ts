import type { RunRecord } from '../storage/types.js';
import type { WorkerStatus } from './worker-report.js';

export interface ExecutorResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Status reported via the MCP report_status tool, if called. */
  workerStatus?: WorkerStatus;
  workerSummary?: string;
  workerFollowUps?: string;
}

export interface WorkerExecutor {
  readonly name: string;
  execute(opts: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
  }): Promise<ExecutorResult>;
}
