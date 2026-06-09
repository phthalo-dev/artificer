import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_REVIEW_CYCLES,
  MAX_PHASE_ITERATIONS,
  type WorkstreamFacts,
  nextWorkstreamAction,
} from './workstream-machine.js';
import type { WorkstreamPhase } from '../storage/types.js';

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
    totalRuns: 1,
    maxRuns: 40,
    currentPhase: 'implementing',
    iterationsInPhase: 0,
    maxPhaseIterations: MAX_PHASE_ITERATIONS,
    consecutiveRejectedReviews: 0,
    plannerReviewerOscillationCycles: 0,
    lastReviewerNoSubmit: false,
    consecutiveReviewerNoSubmit: 0,
    lastPlannerNoWritePlan: false,
    consecutivePlannerNoWritePlan: 0,
    ...overrides,
  };
}

test('run cap takes precedence over everything', () => {
  const a = nextWorkstreamAction(
    facts({ totalRuns: 40, maxRuns: 40, patchPresent: true, lastReviewApproved: true }),
  );
  assert.equal(a.kind, 'blocked');
});

test('setup phase: repo task with no local clone -> setup', () => {
  const a = nextWorkstreamAction(
    facts({ currentPhase: 'setup', repoReady: false, planWritten: false }),
  );
  assert.deepEqual(a, { kind: 'setup' });
});

test('setup phase: repo ready -> phase complete to planning', () => {
  const a = nextWorkstreamAction(
    facts({ currentPhase: 'setup', repoReady: true }),
  );
  assert.deepEqual(a, { kind: 'phase_complete', nextPhase: 'planning' });
});

test('planning phase: no plan -> planner', () => {
  const a = nextWorkstreamAction(
    facts({ currentPhase: 'planning', planWritten: false }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'planner');
});

test('planning phase: two planner no-write streaks -> escalate', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'planning',
      planWritten: false,
      consecutivePlannerNoWritePlan: 2,
    }),
  );
  assert.equal(a.kind, 'escalate');
  assert.match(
    (a as { reason: string }).reason,
    /without calling write_plan 2 times/,
  );
});

test('planning phase: planner no-write dispatches PLAN_RETRY_TASK', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'planning',
      planWritten: false,
      lastPlannerNoWritePlan: true,
    }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'planner');
  assert.match((a as { task: string }).task, /write_plan NOW/);
});

test('planning phase: plan written -> phase complete to implementing', () => {
  const a = nextWorkstreamAction(
    facts({ currentPhase: 'planning', planWritten: true }),
  );
  assert.deepEqual(a, { kind: 'phase_complete', nextPhase: 'implementing' });
});

test('implementing phase: no patch -> worker implements', () => {
  const a = nextWorkstreamAction(
    facts({ currentPhase: 'implementing', patchPresent: false }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'worker');
});

test('implementing phase: patch present, never reviewed -> reviewer', () => {
  const a = nextWorkstreamAction(
    facts({ currentPhase: 'implementing', patchPresent: true, reviewCount: 0 }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'reviewer');
});

test('implementing phase: approved review -> phase complete to verifying', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      patchPresent: true,
      reviewCount: 1,
      lastReviewApproved: true,
    }),
  );
  assert.deepEqual(a, { kind: 'phase_complete', nextPhase: 'verifying' });
});

test('implementing phase: rejected review with new worker output -> re-review', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      patchPresent: true,
      reviewCount: 1,
      lastReviewApproved: false,
      workSinceLastReview: 1,
    }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'reviewer');
});

test('implementing phase: rejected review, worker has not addressed it -> worker fixes', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      patchPresent: true,
      reviewCount: 1,
      lastReviewApproved: false,
      workSinceLastReview: 0,
    }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'worker');
});

test('verifying phase -> done', () => {
  const a = nextWorkstreamAction(facts({ currentPhase: 'verifying' }));
  assert.deepEqual(a, { kind: 'done' });
});

test('done phase -> done', () => {
  const a = nextWorkstreamAction(facts({ currentPhase: 'done' }));
  assert.deepEqual(a, { kind: 'done' });
});

test('consecutive rejected reviews -> escalate', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      consecutiveRejectedReviews: MAX_REVIEW_CYCLES,
    }),
  );
  assert.equal(a.kind, 'escalate');
});

test('planner-reviewer oscillation -> escalate', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'planning',
      plannerReviewerOscillationCycles: MAX_REVIEW_CYCLES,
    }),
  );
  assert.equal(a.kind, 'escalate');
});

test('phase iteration limit exceeded -> escalate', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      iterationsInPhase: MAX_PHASE_ITERATIONS,
      maxPhaseIterations: MAX_PHASE_ITERATIONS,
    }),
  );
  assert.equal(a.kind, 'escalate');
});

test('reviewer no-submit: hint task dispatched on first miss', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      patchPresent: true,
      reviewCount: 0,
      workSinceLastReview: 1,
      lastReviewerNoSubmit: true,
    }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'reviewer');
  assert.match((a as { task: string }).task, /submit_review/);
  assert.doesNotMatch(
    (a as { task: string }).task,
    /Review the current diff against the goal/,
  );
});

test('reviewer no-submit: still dispatches a hint when no review is recorded', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      patchPresent: true,
      reviewCount: 0,
      lastReviewerNoSubmit: true,
    }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.equal((a as { role: string }).role, 'reviewer');
});

test('reviewer no-submit streak hits cap -> escalate', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      consecutiveReviewerNoSubmit: 2,
    }),
  );
  assert.equal(a.kind, 'escalate');
  assert.match(
    (a as { reason: string }).reason,
    /without calling submit_review 2 times/,
  );
});

test('happy reviewer with no patch and no previous no-submit -> standard REVIEW_TASK', () => {
  const a = nextWorkstreamAction(
    facts({
      currentPhase: 'implementing',
      patchPresent: true,
      reviewCount: 0,
      workSinceLastReview: 1,
      lastReviewerNoSubmit: false,
    }),
  );
  assert.equal(a.kind, 'dispatch');
  assert.match((a as { task: string }).task, /Review the current diff/);
});

test('full happy path converges through phases', () => {
  let f = facts({ currentPhase: 'setup', repoReady: false, planWritten: false });
  assert.equal(nextWorkstreamAction(f).kind, 'setup');

  f = facts({ currentPhase: 'setup', repoReady: true });
  assert.deepEqual(nextWorkstreamAction(f), { kind: 'phase_complete', nextPhase: 'planning' });

  f = facts({ currentPhase: 'planning', planWritten: false });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'planner');

  f = facts({ currentPhase: 'planning', planWritten: true });
  assert.deepEqual(nextWorkstreamAction(f), { kind: 'phase_complete', nextPhase: 'implementing' });

  f = facts({ currentPhase: 'implementing', patchPresent: false });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'worker');

  f = facts({ currentPhase: 'implementing', patchPresent: true, reviewCount: 0 });
  assert.equal((nextWorkstreamAction(f) as { role: string }).role, 'reviewer');

  f = facts({ currentPhase: 'implementing', patchPresent: true, reviewCount: 1, lastReviewApproved: true });
  assert.deepEqual(nextWorkstreamAction(f), { kind: 'phase_complete', nextPhase: 'verifying' });

  f = facts({ currentPhase: 'verifying' });
  assert.deepEqual(nextWorkstreamAction(f), { kind: 'done' });
});
