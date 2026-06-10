import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectConvergenceStall,
  detectConvergenceStallFromCounts,
  trailingPlannerNoWritePlan,
  trailingPlannerReviewerCycles,
  trailingRejectedReviewCount,
  trailingReviewerNoSubmit,
  runHasVerifiedDeclareDone,
} from './convergence.js';
import type { RunRecord, Review } from '../storage/types.js';

function review(approved: boolean, at: string): Review {
  return {
    id: `rev_${at}`,
    workstreamId: 'ws_1',
    target: 'work',
    notes: approved ? 'ok' : 'fix',
    approved,
    createdAt: at,
  };
}

function run(
  role: RunRecord['role'],
  at: string,
  options: {
    submitted?: boolean;
    status?: RunRecord['status'];
    toolName?: string;
  } = {},
): RunRecord {
  const toolCalls = options.submitted
    ? [
        {
          name: options.toolName ?? 'submit_review',
          input: {},
          output: 'ok',
          at: `${at}T00:00:00.000Z`,
        },
      ]
    : [];
  return {
    id: `run_${at}`,
    role,
    task: 't',
    status: options.status ?? 'done',
    workstreamId: 'ws_1',
    toolCalls,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 1,
    },
    createdAt: at,
  };
}

test('trailingRejectedReviewCount counts only trailing rejections', () => {
  const reviews = [
    review(false, '1'),
    review(true, '2'),
    review(false, '3'),
    review(false, '4'),
  ];
  assert.equal(trailingRejectedReviewCount(reviews), 2);
});

test('trailingPlannerReviewerCycles counts trailing pairs only', () => {
  const runs = [
    run('planner', '1'),
    run('reviewer', '2'),
    run('worker', '3'),
    run('planner', '4'),
    run('reviewer', '5'),
    run('planner', '6'),
    run('reviewer', '7'),
  ];
  assert.equal(trailingPlannerReviewerCycles(runs), 2);
});

test('detectConvergenceStall triggers on consecutive rejected reviews', () => {
  const reviews = [
    review(false, '1'),
    review(false, '2'),
    review(false, '3'),
  ];
  const reason = detectConvergenceStall([], reviews);
  assert.equal(reason?.kind, 'rejected_reviews');
});

test('detectConvergenceStall triggers on plan/review oscillation', () => {
  const runs = [
    run('planner', '1'),
    run('reviewer', '2'),
    run('planner', '3'),
    run('reviewer', '4'),
    run('planner', '5'),
    run('reviewer', '6'),
  ];
  // Two rejections — below the rejected-reviews threshold, but three cycles.
  const reviews = [review(false, '4'), review(false, '6')];
  const reason = detectConvergenceStall(runs, reviews);
  assert.equal(reason?.kind, 'plan_review_oscillation');
});

test('trailingPlannerNoWritePlan counts trailing planner runs without write_plan', () => {
  const runs = [
    run('planner', '1', { submitted: true, toolName: 'write_plan' }),
    run('planner', '2', { submitted: false }),
    run('planner', '3', { submitted: false }),
  ];
  assert.equal(trailingPlannerNoWritePlan(runs), 2);
});

test('trailingPlannerNoWritePlan counts failed planner runs without write_plan', () => {
  const runs = [
    run('planner', '1', { status: 'failed' }),
    run('planner', '2', { submitted: false }),
  ];
  assert.equal(trailingPlannerNoWritePlan(runs), 2);
});

test('trailingPlannerNoWritePlan resets when planner writes plan', () => {
  const runs = [
    run('planner', '1', { submitted: false }),
    run('planner', '2', { submitted: true, toolName: 'write_plan' }),
    run('planner', '3', { submitted: false }),
  ];
  assert.equal(trailingPlannerNoWritePlan(runs), 1);
});

test('detectConvergenceStallFromCounts triggers on oscillation without rejections', () => {
  const reason = detectConvergenceStallFromCounts(0, 3);
  assert.equal(reason?.kind, 'plan_review_oscillation');
});

test('detectConvergenceStall does not trigger when reviews approve', () => {
  const runs = [
    run('planner', '1'),
    run('reviewer', '2'),
    run('planner', '3'),
    run('reviewer', '4'),
  ];
  const reviews = [review(true, '2'), review(true, '4')];
  assert.equal(detectConvergenceStall(runs, reviews), undefined);
});

test('trailingReviewerNoSubmit counts trailing no-submit reviewers', () => {
  const runs = [
    run('reviewer', '1', { submitted: false }),
    run('worker', '2'),
    run('reviewer', '3', { submitted: false }),
    run('reviewer', '4', { submitted: false }),
  ];
  // Three trailing reviewer runs that did not call submit_review, in order.
  assert.equal(trailingReviewerNoSubmit(runs), 3);
});

test('trailingReviewerNoSubmit resets when a reviewer submits', () => {
  const runs = [
    run('reviewer', '1', { submitted: false }),
    run('reviewer', '2', { submitted: true }),
    run('reviewer', '3', { submitted: false }),
  ];
  assert.equal(trailingReviewerNoSubmit(runs), 1);
});

test('trailingReviewerNoSubmit ignores non-reviewer runs and queued/running', () => {
  const runs = [
    run('reviewer', '1', { submitted: false }),
    run('reviewer', '2', { submitted: false, status: 'running' }),
    run('planner', '3'),
    run('worker', '4'),
  ];
  // Only done reviewer runs that did not submit count, and runs are sorted by
  // createdAt; the running reviewer is excluded.
  assert.equal(trailingReviewerNoSubmit(runs), 1);
});

test('runHasVerifiedDeclareDone requires verified=true on declare_done', () => {
  const verified: RunRecord = {
    ...run('worker', '1'),
    toolCalls: [
      {
        name: 'declare_done',
        input: { summary: 'fixed', verified: true },
        output: 'DONE: fixed',
        at: '2024-01-01T00:00:00.000Z',
      },
    ],
  };
  const unverified: RunRecord = {
    ...run('worker', '2'),
    toolCalls: [
      {
        name: 'declare_done',
        input: { summary: 'fixed', verified: false },
        output: 'Error: verified must be true',
        error: 'verified must be true',
        at: '2024-01-01T00:00:00.000Z',
      },
    ],
  };
  assert.equal(runHasVerifiedDeclareDone(verified), true);
  assert.equal(runHasVerifiedDeclareDone(unverified), false);
});
