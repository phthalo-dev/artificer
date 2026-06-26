import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_REVIEW_CYCLES,
  MAX_WORKER_RUNS_BEFORE_REVIEW,
  type WorkstreamFacts,
  nextWorkstreamAction,
} from './workstream-machine.js';
import { MAX_NO_PROGRESS_REPEATS } from './worker-progress.js';

/** A workstream that has set up a repo and written a plan, no work yet. */
function facts(overrides: Partial<WorkstreamFacts> = {}): WorkstreamFacts {
  return {
    hasRepoUrl: true,
    repoReady: true,
    planWritten: true,
    patchPresent: false,
    reviewCount: 0,
    lastReviewApproved: undefined,
    workSinceLastReview: 0,
    lastWorkerDone: false,
    consecutiveFailedRuns: 0,
    plannerRunsWithoutPlan: 0,
    noProgressRepeats: 0,
    prSubmitted: false,
    totalRuns: 1,
    maxRuns: 40,
    ...overrides,
  };
}

test('planner that keeps finishing without a plan falls through to a direct worker', () => {
  const a = nextWorkstreamAction(
    facts({ planWritten: false, plannerRunsWithoutPlan: 3, patchPresent: false }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'worker');
  assert.match((a as { task: string }).task, /implement the goal directly/i);
});

test('a couple of planner attempts without a plan still dispatch the planner', () => {
  const a = nextWorkstreamAction(
    facts({ planWritten: false, plannerRunsWithoutPlan: 2 }),
  );
  assert.equal((a as { role: string }).role, 'planner');
});

test('consecutive failed runs block early (resilience to a failing model/endpoint)', () => {
  const a = nextWorkstreamAction(
    facts({ planWritten: false, consecutiveFailedRuns: 3 }),
  );
  assert.equal(a.kind, 'blocked');
});

test('a single failure does not block prematurely', () => {
  const a = nextWorkstreamAction(
    facts({ planWritten: false, consecutiveFailedRuns: 1 }),
  );
  assert.equal((a as { role: string }).role, 'planner');
});

test('run cap takes precedence over everything', () => {
  const a = nextWorkstreamAction(
    facts({ totalRuns: 40, maxRuns: 40, patchPresent: true, lastReviewApproved: true }),
  );
  assert.equal(a.kind, 'blocked');
});

test('repo task with no local clone -> setup', () => {
  const a = nextWorkstreamAction(facts({ repoReady: false, planWritten: false }));
  assert.deepEqual(a, { kind: 'setup' });
});

test('non-repo task skips setup and goes to planning', () => {
  const a = nextWorkstreamAction(
    facts({ hasRepoUrl: false, repoReady: false, planWritten: false }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'planner');
});

test('repo ready but no plan -> planner', () => {
  const a = nextWorkstreamAction(facts({ planWritten: false }));
  assert.equal((a as { role: string }).role, 'planner');
});

test('plan written but no patch -> worker implements', () => {
  const a = nextWorkstreamAction(facts({ patchPresent: false }));
  assert.equal((a as { role: string }).role, 'worker');
});

test('patch present, worker reports done -> reviewer', () => {
  const a = nextWorkstreamAction(
    facts({ patchPresent: true, reviewCount: 0, workSinceLastReview: 1, lastWorkerDone: true }),
  );
  assert.equal((a as { role: string }).role, 'reviewer');
});

test('patch present but worker still working (not done, under cap) -> keep implementing', () => {
  const a = nextWorkstreamAction(
    facts({ patchPresent: true, reviewCount: 0, workSinceLastReview: 2, lastWorkerDone: false }),
  );
  assert.equal((a as { role: string }).role, 'worker');
});

test('worker thrashing with no progress -> blocked instead of re-dispatched', () => {
  const a = nextWorkstreamAction(
    facts({
      patchPresent: true,
      reviewCount: 0,
      workSinceLastReview: 1,
      lastWorkerDone: false,
      noProgressRepeats: MAX_NO_PROGRESS_REPEATS,
    }),
  );
  assert.equal(a.kind, 'blocked');
  assert.match((a as { reason: string }).reason, /not_converging/);
});

test('a single non-progressing run does not block yet', () => {
  const a = nextWorkstreamAction(
    facts({
      patchPresent: true,
      reviewCount: 0,
      workSinceLastReview: 1,
      lastWorkerDone: false,
      noProgressRepeats: MAX_NO_PROGRESS_REPEATS - 1,
    }),
  );
  assert.equal((a as { role: string }).role, 'worker');
});

test('worker never reports done -> review forced at the per-review cap', () => {
  const a = nextWorkstreamAction(
    facts({
      patchPresent: true,
      reviewCount: 0,
      workSinceLastReview: MAX_WORKER_RUNS_BEFORE_REVIEW,
      lastWorkerDone: false,
    }),
  );
  assert.equal((a as { role: string }).role, 'reviewer');
});

test('patch present and approved with repo -> submit PR before done', () => {
  const a = nextWorkstreamAction(
    facts({ patchPresent: true, reviewCount: 1, lastReviewApproved: true, hasRepoUrl: true, prSubmitted: false }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'worker');
  assert.match((a as { task: string }).task, /pull request/i);
});

test('patch present, approved, and PR already submitted -> done', () => {
  const a = nextWorkstreamAction(
    facts({ patchPresent: true, reviewCount: 1, lastReviewApproved: true, prSubmitted: true }),
  );
  assert.deepEqual(a, { kind: 'done' });
});

test('non-repo task approved -> done without PR step', () => {
  const a = nextWorkstreamAction(
    facts({ patchPresent: true, reviewCount: 1, lastReviewApproved: true, hasRepoUrl: false }),
  );
  assert.deepEqual(a, { kind: 'done' });
});

test('rejected review, worker addressed it and reports done -> re-review', () => {
  const a = nextWorkstreamAction(
    facts({
      patchPresent: true,
      reviewCount: 1,
      lastReviewApproved: false,
      workSinceLastReview: 1,
      lastWorkerDone: true,
    }),
  );
  assert.equal((a as { role: string }).role, 'reviewer');
});

test('rejected review, worker has not addressed it -> worker fixes', () => {
  const a = nextWorkstreamAction(
    facts({
      patchPresent: true,
      reviewCount: 1,
      lastReviewApproved: false,
      workSinceLastReview: 0,
    }),
  );
  assert.equal((a as { role: string }).role, 'worker');
});

test('too many rejected reviews without convergence -> blocked', () => {
  const a = nextWorkstreamAction(
    facts({
      patchPresent: true,
      reviewCount: MAX_REVIEW_CYCLES,
      lastReviewApproved: false,
      workSinceLastReview: 0,
    }),
  );
  assert.equal(a.kind, 'blocked');
});

test('approved review + clean working tree (committed) + PR submitted -> done (not an implement loop)', () => {
  // Regression: after the submit worker commits the patch the working tree
  // becomes clean (patchPresent = false). The machine must not re-enter the
  // implement loop — it should see the approval and return done.
  const a = nextWorkstreamAction(
    facts({ patchPresent: false, reviewCount: 1, lastReviewApproved: true, prSubmitted: true }),
  );
  assert.deepEqual(a, { kind: 'done' });
});

test('approved review + clean working tree + PR not yet submitted -> re-dispatch submit', () => {
  // Commit happened but push failed; the machine should retry the submit
  // worker rather than falling into an implement loop.
  const a = nextWorkstreamAction(
    facts({ patchPresent: false, reviewCount: 1, lastReviewApproved: true, prSubmitted: false }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'worker');
  assert.match((a as { task: string }).task, /pull request/i);
});

test('full happy path converges to done without an orchestrator', () => {
  // setup -> plan -> implement -> review -> submit PR -> done, driven only by facts.
  let f = facts({ repoReady: false, planWritten: false });
  assert.equal(nextWorkstreamAction(f).kind, 'setup');

  f = facts({ planWritten: false });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'planner');

  f = facts({ patchPresent: false });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'worker');

  f = facts({ patchPresent: true, reviewCount: 0, workSinceLastReview: 1, lastWorkerDone: true });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'reviewer');

  f = facts({ patchPresent: true, reviewCount: 1, lastReviewApproved: true, prSubmitted: false });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'worker');

  f = facts({ patchPresent: true, reviewCount: 1, lastReviewApproved: true, prSubmitted: true });
  assert.equal(nextWorkstreamAction(f).kind, 'done');
});
