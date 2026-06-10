import type { RunRecord } from '../storage/types.js';

export type WorkerStatus =
  | 'done'
  | 'done_with_concerns'
  | 'blocked'
  | 'needs_context';

const VALID_STATUSES = new Set<WorkerStatus>([
  'done',
  'done_with_concerns',
  'blocked',
  'needs_context',
]);

const DONE_STATUSES = new Set<WorkerStatus>(['done', 'done_with_concerns']);

export interface WorkerReport {
  status: WorkerStatus;
  summary: string;
  followUps?: string;
}

/**
 * The most recent successful report_status call in a run, if any. Workers may
 * call report_status more than once (e.g. revising); the last call wins.
 */
export function lastWorkerReport(run: RunRecord): WorkerReport | undefined {
  for (let i = run.toolCalls.length - 1; i >= 0; i -= 1) {
    const call = run.toolCalls[i];
    if (call.name !== 'report_status' || call.error) continue;
    const input = call.input as Record<string, unknown> | undefined;
    const status = input?.status;
    const summary = input?.summary;
    if (typeof status !== 'string' || !VALID_STATUSES.has(status as WorkerStatus)) {
      continue;
    }
    if (typeof summary !== 'string') continue;
    return {
      status: status as WorkerStatus,
      summary,
      followUps: typeof input?.followUps === 'string' ? input.followUps : undefined,
    };
  }
  return undefined;
}

// Fallback for runs that finished without calling report_status: a status
// line on its own (optionally surrounded by whitespace), not a substring of a
// longer phrase like "NOT DONE".
const FALLBACK_DONE_RE = /^\s*(DONE|DONE_WITH_CONCERNS)\s*$/im;

/** Whether a finished worker run reported (or otherwise indicated) it is done. */
export function workerRunDone(run: RunRecord): boolean {
  const report = lastWorkerReport(run);
  if (report) return DONE_STATUSES.has(report.status);
  return FALLBACK_DONE_RE.test(run.output ?? '');
}

/** A short summary of what a worker run reported, for task results and context. */
export function workerRunSummary(run: RunRecord): string | undefined {
  const report = lastWorkerReport(run);
  if (!report) return undefined;
  const lines = [`[${report.status.toUpperCase()}] ${report.summary.trim()}`];
  if (report.followUps?.trim()) {
    lines.push(`Follow-ups: ${report.followUps.trim()}`);
  }
  return lines.join('\n');
}
