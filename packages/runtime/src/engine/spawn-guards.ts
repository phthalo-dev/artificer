import type { Store } from '../storage/store.js';
import type { Review, RunRecord } from '../storage/types.js';

function hasSuccessfulTool(run: RunRecord, name: string): boolean {
  return run.toolCalls.some((t) => t.name === name && !t.error);
}

function lastDoneRun(runs: RunRecord[]): RunRecord | undefined {
  return runs
    .filter((r) => r.status === 'done')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}

function latestPlanReview(reviews: Review[]): Review | undefined {
  return reviews
    .filter((r) => r.stage === 'plan')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}

/** Planner run with write_plan that completed after the given review timestamp. */
function revisingPlannerAfterReview(
  runs: RunRecord[],
  review: Review,
): boolean {
  return runs.some(
    (r) =>
      r.role === 'planner' &&
      r.status === 'done' &&
      r.createdAt >= review.createdAt &&
      hasSuccessfulTool(r, 'write_plan'),
  );
}

/**
 * Returns an error message when spawning another planner would duplicate work
 * already queued, in flight, or ready for review.
 */
export async function plannerSpawnBlocked(
  store: Store,
  workstreamId: string,
): Promise<string | undefined> {
  const runs = await store.listRunsForWorkstream(workstreamId);
  const activePlanner = runs.some(
    (r) =>
      r.role === 'planner' &&
      (r.status === 'queued' || r.status === 'running'),
  );
  if (activePlanner) {
    return (
      'A planner call is already queued or running for this workstream. ' +
      'Wait for it to finish; if write_plan succeeded, spawn a reviewer (stage "plan") next.'
    );
  }

  const plan = await store.readPlan(workstreamId);
  if (!plan) return undefined;

  const reviews = await store.listReviews(workstreamId);
  const latest = latestPlanReview(reviews);

  if (!latest) {
    return (
      'A plan already exists (hasPlan=true). Spawn a reviewer with stage "plan" ' +
      'to review it — do not spawn another planner unless the review rejected the plan.'
    );
  }
  if (latest.approved) {
    return (
      'The plan is already approved. Spawn worker calls to implement it, not another planner.'
    );
  }

  const lastDone = lastDoneRun(runs);
  if (lastDone?.role === 'planner' && !hasSuccessfulTool(lastDone, 'write_plan')) {
    return (
      'The previous planner finished without calling write_plan. Re-spawn ONE planner ' +
      'instructed to revise the plan per the rejection notes and call write_plan — ' +
      'do not start another planner while that revision is incomplete.'
    );
  }

  if (revisingPlannerAfterReview(runs, latest)) {
    return (
      'The plan was revised after the last rejection (write_plan succeeded). ' +
      'Spawn a plan reviewer next — do not spawn another planner until that review completes.'
    );
  }

  return undefined;
}

/**
 * Returns an error when spawn_agent would start a worker before a plan exists.
 * Prevents orchestrators from bypassing the planning phase.
 */
export async function workerAgentSpawnBlocked(
  store: Store,
  workstreamId: string,
): Promise<string | undefined> {
  const plan = await store.readPlan(workstreamId);
  if (plan) return undefined;

  return (
    'No plan exists for this workstream (write_plan was never called). ' +
    'Do not spawn worker agents until a planner records a plan. ' +
    'Let the FSM dispatch PLAN_RETRY_TASK or spawn one planner instructed to call write_plan.'
  );
}

/** Returns an error when spawning a duplicate plan reviewer. */
export async function reviewerSpawnBlocked(
  store: Store,
  workstreamId: string,
  stage: 'plan' | 'work',
): Promise<string | undefined> {
  const runs = await store.listRunsForWorkstream(workstreamId);
  const activeReviewer = runs.some(
    (r) =>
      r.role === 'reviewer' &&
      (r.status === 'queued' || r.status === 'running'),
  );
  if (activeReviewer) {
    return (
      'A reviewer call is already queued or running. Wait for it to finish before spawning another.'
    );
  }

  if (stage === 'plan') {
    const reviews = await store.listReviews(workstreamId);
    if (reviews.some((r) => r.stage === 'plan' && r.approved)) {
      return 'The plan is already approved. Spawn worker calls to implement it.';
    }

    const latest = latestPlanReview(reviews);
    if (latest && !latest.approved && !revisingPlannerAfterReview(runs, latest)) {
      return (
        'The plan review was rejected. Spawn a planner to revise the plan and call write_plan ' +
        'before spawning another plan reviewer.'
      );
    }
  }
  return undefined;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * When a reviewer finishes without submit_review but a plan exists, record a
 * fallback approval so implementation is not blocked for the rest of the timeout.
 */
export async function recordPlanReviewFallback(
  store: Store,
  workstreamId: string,
  reviewerOutput: string | undefined,
): Promise<void> {
  const reviews = await store.listReviews(workstreamId);
  if (reviews.some((r) => r.stage === 'plan')) return;

  await store.createReview({
    workstreamId,
    target: 'plan',
    stage: 'plan',
    approved: true,
    severity: 'minor',
    notes: [
      '[System] Plan review auto-approved because the reviewer finished without calling submit_review.',
      'Proceed to worker implementation. Reviewer notes:',
      clip(reviewerOutput?.trim() || '(none)', 1_500),
    ].join('\n'),
  });
}
