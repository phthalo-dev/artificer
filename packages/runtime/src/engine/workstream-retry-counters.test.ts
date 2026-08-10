import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeRetryCounters } from './workstream-retry-counters.js';
import type { Review, RunRecord } from '../storage/types.js';

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: overrides.id ?? `run-${Math.random()}`,
    role: 'worker',
    task: 'do the thing',
    status: 'done',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 0,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: overrides.id ?? `review-${Math.random()}`,
    workstreamId: 'ws-1',
    target: 'work',
    notes: '',
    approved: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('no runs or reviews yields all-zero counters', () => {
  const counters = computeRetryCounters(true, [], []);
  assert.deepEqual(counters, {
    reviewCount: 0,
    workSinceLastReview: 0,
    noProgressRepeats: 0,
    consecutiveFailedRuns: 0,
    plannerRunsWithoutPlan: 0,
    totalRuns: 0,
  });
});

test('workSinceLastReview only counts done worker runs after the latest review', () => {
  const reviews = [review({ id: 'r1', createdAt: '2026-01-01T00:10:00.000Z' })];
  const runs = [
    run({ id: 'w0', createdAt: '2026-01-01T00:05:00.000Z' }), // before the review
    run({ id: 'w1', createdAt: '2026-01-01T00:20:00.000Z' }),
    run({ id: 'w2', createdAt: '2026-01-01T00:30:00.000Z' }),
    run({ id: 'planner', role: 'planner', createdAt: '2026-01-01T00:25:00.000Z' }), // not a worker run
  ];
  const counters = computeRetryCounters(true, reviews, runs);
  assert.equal(counters.workSinceLastReview, 2);
  assert.equal(counters.reviewCount, 1);
});

test('consecutiveFailedRuns counts only the trailing run of failures', () => {
  const runs = [
    run({ id: 'a', status: 'failed', createdAt: '2026-01-01T00:01:00.000Z' }),
    run({ id: 'b', status: 'done', createdAt: '2026-01-01T00:02:00.000Z' }),
    run({ id: 'c', status: 'failed', createdAt: '2026-01-01T00:03:00.000Z' }),
    run({ id: 'd', status: 'failed', createdAt: '2026-01-01T00:04:00.000Z' }),
  ];
  const counters = computeRetryCounters(true, [], runs);
  assert.equal(counters.consecutiveFailedRuns, 2);
});

test('plannerRunsWithoutPlan is 0 once a plan exists, regardless of prior planner runs', () => {
  const runs = [
    run({ id: 'p1', role: 'planner', createdAt: '2026-01-01T00:01:00.000Z' }),
    run({ id: 'p2', role: 'planner', createdAt: '2026-01-01T00:02:00.000Z' }),
  ];
  assert.equal(computeRetryCounters(false, [], runs).plannerRunsWithoutPlan, 2);
  assert.equal(computeRetryCounters(true, [], runs).plannerRunsWithoutPlan, 0);
});

test('totalRuns counts every run regardless of role or status', () => {
  const runs = [
    run({ id: 'a', role: 'planner' }),
    run({ id: 'b', role: 'worker', status: 'failed' }),
    run({ id: 'c', role: 'reviewer' }),
  ];
  assert.equal(computeRetryCounters(true, [], runs).totalRuns, 3);
});
