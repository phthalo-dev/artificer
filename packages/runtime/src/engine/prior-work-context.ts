import type { RunRecord } from '../storage/types.js';
import { lastWorkerReport } from './worker-report.js';

/**
 * Build a "Prior work in this session" context string from the completed worker
 * runs since the last review. Returns undefined when there are no prior runs.
 *
 * Workers that called report_status contribute their summary. Workers that did
 * not (e.g. budget exhaustion) contribute a list of files they successfully
 * wrote. This prevents subsequent workers from re-investigating what is already
 * done or starting over when a partial scaffold exists.
 */
export function buildPriorWorkContext(workerRuns: RunRecord[]): string | undefined {
  if (workerRuns.length === 0) return undefined;

  const lines = workerRuns.map((run, i) => {
    const report = lastWorkerReport(run);
    if (report) {
      return `- Run ${i + 1}: [${report.status.toUpperCase()}] ${report.summary.trim()}`;
    }

    const writtenFiles = run.toolCalls
      .filter((t) => t.name === 'write_file' && !t.error)
      .map((t) => (t.input as { path?: string }).path)
      .filter((p): p is string => typeof p === 'string');

    if (writtenFiles.length > 0) {
      return (
        `- Run ${i + 1}: Created/modified ${writtenFiles.join(', ')}` +
        ` (no status reported — likely budget exhaustion).`
      );
    }

    return `- Run ${i + 1}: No changes made.`;
  });

  return (
    `Prior work in this session:\n${lines.join('\n')}\n` +
    `Continue from here rather than re-investigating from scratch.`
  );
}
