import type { RuntimeEvent } from '../context.js';
import type { RunRecord, ToolInvocation } from '../storage/types.js';
import type { ToolPolicyFile } from '../tools/tool-policy.js';
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
    /** Tool policy for executors that gate the agent's own permission requests. */
    policy?: ToolPolicyFile;
    /** Called once per agent tool call that reaches a final state. */
    onToolCall?: (invocation: ToolInvocation) => void;
    /** Emits runtime events (for example approvals) from inside the executor. */
    emit?: (event: RuntimeEvent) => void;
  }): Promise<ExecutorResult>;
}
