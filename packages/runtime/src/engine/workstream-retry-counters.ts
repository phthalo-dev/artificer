import type { Review, RunRecord } from '../storage/types.js';
import { countNoProgressRepeats } from './worker-progress.js';

export interface RetryCounters {
  /** Total reviews recorded (plan + work stages combined). */
  reviewCount: number;
  /** Done worker runs since the most recent review. */
  workSinceLastReview: number;
  /** Trailing worker runs since the last review that made no progress. */
  noProgressRepeats: number;
  /** Trailing run of consecutive failed runs, most-recent-first. */
  consecutiveFailedRuns: number;
  /** Completed planner runs so far, only counted while no plan exists yet. */
  plannerRunsWithoutPlan: number;
  /** Every run in the workstream, any role or status. */
  totalRuns: number;
}

/**
 * Independently re-derives the same five counters `Engine.computeFacts`
 * (packages/runtime/src/engine/engine.ts) computes for the state machine,
 * from the same raw records. Kept separate (not extracted from computeFacts)
 * because computeFacts is on the hot dispatch path and also computes
 * FSM-only concerns (repoDir, patchPresent, prSubmitted) this doesn't need —
 * see this plan's Global Constraints. If you change how a counter is
 * computed here, check engine.ts's computeFacts for the same drift.
 */
export function computeRetryCounters(
  hasPlan: boolean,
  reviews: Review[],
  wsRuns: RunRecord[],
): RetryCounters {
  const sortedReviews = [...reviews].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const lastReview = sortedReviews.at(-1);

  const workerRunsSinceReview = wsRuns
    .filter(
      (r) =>
        r.role === 'worker' &&
        r.status === 'done' &&
        (!lastReview || r.createdAt > lastReview.createdAt),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const ordered = [...wsRuns].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  let consecutiveFailedRuns = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (ordered[i].status === 'failed') consecutiveFailedRuns += 1;
    else break;
  }

  return {
    reviewCount: sortedReviews.length,
    workSinceLastReview: workerRunsSinceReview.length,
    noProgressRepeats: countNoProgressRepeats(workerRunsSinceReview),
    consecutiveFailedRuns,
    plannerRunsWithoutPlan: hasPlan
      ? 0
      : wsRuns.filter((r) => r.role === 'planner' && r.status === 'done')
          .length,
    totalRuns: wsRuns.length,
  };
}
