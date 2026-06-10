import type { RunRecord } from '../storage/types.js';
import { workerRunDone } from './worker-report.js';

/** Trailing no-progress worker runs before the workstream is blocked. */
export const MAX_NO_PROGRESS_REPEATS = 2;

const MUTATING_TOOLS = new Set(['edit_file', 'write_file']);

/** Sorted signature of a run's successful edits, or '' if it made none. */
function mutatingCallSignature(run: RunRecord): string {
  return run.toolCalls
    .filter((t) => MUTATING_TOOLS.has(t.name) && !t.error)
    .map((t) => `${t.name}:${JSON.stringify(t.input)}`)
    .sort()
    .join('|');
}

function trailingCount<T>(items: T[], stuck: (item: T) => boolean): number {
  let count = 0;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (!stuck(items[i])) break;
    count += 1;
  }
  return count;
}

/** Length of the trailing run of identical non-empty signatures (0 or 1 occurrence is not a repeat). */
function trailingIdenticalNonEmpty(values: string[]): number {
  const last = values.at(-1);
  if (!last) return 0;
  const count = trailingCount(values, (v) => v === last);
  return count >= 2 ? count : 0;
}

/**
 * Counts trailing worker runs (since the last review) that made no progress:
 * either each made zero edits and did not report finishing, or each made the
 * exact same (non-empty) set of edits — a thrash loop repeating one change.
 */
export function countNoProgressRepeats(workerRuns: RunRecord[]): number {
  const ordered = workerRuns
    .filter((r) => r.status === 'done')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const trailingStuck = trailingCount(
    ordered,
    (run) => mutatingCallSignature(run) === '' && !workerRunDone(run),
  );

  const trailingRepeatedEdits = trailingIdenticalNonEmpty(
    ordered.map(mutatingCallSignature),
  );

  return Math.max(trailingStuck, trailingRepeatedEdits);
}
