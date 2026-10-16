import type { RunRecord } from '../storage/types.js';
import type { WorkerStatus } from './worker-report.js';

export interface ExecutorReview {
  target: string;
  notes: string;
  approved: boolean;
  stage?: 'plan' | 'work';
  severity?: 'critical' | 'important' | 'minor' | 'none';
}

export interface ExecutorResult {
  text: string;
  sessionId?: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Status reported via the MCP report_status tool, if called. */
  workerStatus?: WorkerStatus;
  workerSummary?: string;
  workerFollowUps?: string;
  /** Review verdict reported via the MCP submit_review tool, if called. */
  review?: ExecutorReview;
}

export interface WorkerExecutor {
  readonly name: string;
  readonly resumesSession?: boolean;
  execute(opts: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
    sessionId?: string;
    signal?: AbortSignal;
  }): Promise<ExecutorResult>;
}
