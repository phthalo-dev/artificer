import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_REVIEW_CYCLES,
  type WorkstreamFacts,
  nextWorkstreamAction,
} from './workstream-machine.js';

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
    consecutiveFailedRuns: 0,
    plannerRunsWithoutPlan: 0,
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

test('patch present, never reviewed -> reviewer', () => {
  const a = nextWorkstreamAction(facts({ patchPresent: true, reviewCount: 0 }));
  assert.equal((a as { role: string }).role, 'reviewer');
});

test('patch present and approved -> done', () => {
  const a = nextWorkstreamAction(
    facts({ patchPresent: true, reviewCount: 1, lastReviewApproved: true }),
  );
  assert.deepEqual(a, { kind: 'done' });
});

test('rejected review with new worker output -> re-review', () => {
  const a = nextWorkstreamAction(
    facts({
      patchPresent: true,
      reviewCount: 1,
      lastReviewApproved: false,
      workSinceLastReview: 1,
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

test('full happy path converges to done without an orchestrator', () => {
  // setup -> plan -> implement -> review -> done, driven only by facts.
  let f = facts({ repoReady: false, planWritten: false });
  assert.equal(nextWorkstreamAction(f).kind, 'setup');

  f = facts({ planWritten: false });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'planner');

  f = facts({ patchPresent: false });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'worker');

  f = facts({ patchPresent: true, reviewCount: 0 });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'reviewer');

  f = facts({ patchPresent: true, reviewCount: 1, lastReviewApproved: true });
  assert.equal(nextWorkstreamAction(f).kind, 'done');
});
