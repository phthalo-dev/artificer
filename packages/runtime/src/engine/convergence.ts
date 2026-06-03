import type { RunRecord, Review } from '../storage/types.js';

/** Consecutive non-approved reviews before pausing the workstream. */
export const MAX_CONSECUTIVE_REJECTED_REVIEWS = 3;

/**
 * Trailing planner→reviewer run pairs with no intervening worker. When reviews
 * keep rejecting and the orchestrator replans instead of fixing, this climbs.
 */
export const MAX_PLANNER_REVIEWER_CYCLES = 3;

/** Count trailing reviews where approved=false. */
export function trailingRejectedReviewCount(reviews: Review[]): number {
  const sorted = [...reviews].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  let count = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (!sorted[i].approved) count += 1;
    else break;
  }
  return count;
}

/**
 * Count trailing (planner, reviewer) run pairs with no worker between them —
 * the planning↔reviewing oscillation pattern.
 */
export function trailingPlannerReviewerCycles(runs: RunRecord[]): number {
  const ordered = [...runs]
    .filter((r) => r.status === 'done')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let cycles = 0;
  for (let i = ordered.length - 1; i >= 1; i -= 1) {
    const reviewer = ordered[i];
    const planner = ordered[i - 1];
    if (reviewer.role === 'reviewer' && planner.role === 'planner') {
      cycles += 1;
      i -= 1;
    } else break;
  }
  return cycles;
}

export type ConvergenceReason =
  | { kind: 'rejected_reviews'; count: number }
  | { kind: 'plan_review_oscillation'; cycles: number; rejectedReviews: number };

/**
 * Returns why a workstream should pause for lack of convergence, or undefined
 * when it should continue.
 */
export function detectConvergenceStall(
  runs: RunRecord[],
  reviews: Review[],
): ConvergenceReason | undefined {
  const rejected = trailingRejectedReviewCount(reviews);
  if (rejected >= MAX_CONSECUTIVE_REJECTED_REVIEWS) {
    return { kind: 'rejected_reviews', count: rejected };
  }

  const cycles = trailingPlannerReviewerCycles(runs);
  if (
    cycles >= MAX_PLANNER_REVIEWER_CYCLES &&
    rejected >= 1
  ) {
    return { kind: 'plan_review_oscillation', cycles, rejectedReviews: rejected };
  }

  return undefined;
}

export function convergenceStallMessage(reason: ConvergenceReason): string {
  switch (reason.kind) {
    case 'rejected_reviews':
      return `Paused after ${reason.count} consecutive reviews did not approve. Further re-planning or re-reviewing is unlikely to help without new information, a model change, or human steering. If verification failed only because the sandbox environment is broken (not because of the code change), record that caveat and consider marking done rather than looping.`;
    case 'plan_review_oscillation':
      return `Paused after ${reason.cycles} planner→reviewer cycles with ${reason.rejectedReviews} recent rejection(s). The workstream is oscillating between re-planning and re-reviewing instead of converging. Send a note to steer, accept with documented caveats, or adjust models.`;
  }
}
