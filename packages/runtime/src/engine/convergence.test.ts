import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectConvergenceStall,
  trailingPlannerReviewerCycles,
  trailingRejectedReviewCount,
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

function run(role: RunRecord['role'], at: string): RunRecord {
  return {
    id: `run_${at}`,
    role,
    task: 't',
    status: 'done',
    workstreamId: 'ws_1',
    toolCalls: [],
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
