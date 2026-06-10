import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  plannerSpawnBlocked,
  recordPlanReviewFallback,
  reviewerSpawnBlocked,
  workerAgentSpawnBlocked,
} from './spawn-guards.js';
import { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';

function plannerRun(
  workstreamId: string,
  status: RunRecord['status'],
  at: string,
): RunRecord {
  return {
    id: `run_${at}`,
    role: 'planner',
    task: 'plan',
    workstreamId,
    status,
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

test('plannerSpawnBlocked when planner is still queued', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({
    title: 't',
    goal: 'g',
    repoUrl: 'https://github.com/org/repo.git',
  });
  await store.saveRun(plannerRun(ws.id, 'queued', '1'));

  const blocked = await plannerSpawnBlocked(store, ws.id);
  assert.ok(blocked?.includes('already queued'));
});

test('plannerSpawnBlocked when plan exists without review', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  await store.writePlan(ws.id, '# Plan\n\nDo the thing.');

  const blocked = await plannerSpawnBlocked(store, ws.id);
  assert.ok(blocked?.includes('reviewer'));
});

test('plannerSpawnBlocked allows replan after rejected plan review', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  await store.writePlan(ws.id, '# Plan');
  await store.createReview({
    workstreamId: ws.id,
    target: 'plan',
    notes: 'fix scope',
    approved: false,
    stage: 'plan',
    severity: 'important',
  });

  assert.equal(await plannerSpawnBlocked(store, ws.id), undefined);
});

test('plannerSpawnBlocked when last planner did not write_plan after rejection', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  await store.writePlan(ws.id, '# Plan');
  await store.createReview({
    workstreamId: ws.id,
    target: 'plan',
    notes: 'fix scope',
    approved: false,
    stage: 'plan',
    severity: 'important',
  });
  await store.saveRun(plannerRun(ws.id, 'done', '2'));

  const blocked = await plannerSpawnBlocked(store, ws.id);
  assert.ok(blocked?.includes('write_plan'));
});

test('plannerSpawnBlocked requires reviewer after revised plan', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  await store.writePlan(ws.id, '# Plan');
  await store.createReview({
    workstreamId: ws.id,
    target: 'plan',
    notes: 'fix scope',
    approved: false,
    stage: 'plan',
    severity: 'important',
  });
  const revised: RunRecord = {
    ...plannerRun(ws.id, 'done', '3'),
    toolCalls: [
      { name: 'write_plan', input: {}, output: 'ok', at: '2026-01-01T00:00:00.000Z' },
    ],
  };
  await store.saveRun(revised);

  const blocked = await plannerSpawnBlocked(store, ws.id);
  assert.ok(blocked?.includes('reviewer'));
});

test('reviewerSpawnBlocked after rejection until write_plan', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  await store.writePlan(ws.id, '# Plan');
  await store.createReview({
    workstreamId: ws.id,
    target: 'plan',
    notes: 'fix scope',
    approved: false,
    stage: 'plan',
    severity: 'important',
  });

  const blocked = await reviewerSpawnBlocked(store, ws.id, 'plan');
  assert.ok(blocked?.includes('write_plan'));
});

test('recordPlanReviewFallback records an approved plan review', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  await store.writePlan(ws.id, '# Plan');

  await recordPlanReviewFallback(store, ws.id, 'looks good to me');

  const reviews = await store.listReviews(ws.id);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].stage, 'plan');
  assert.equal(reviews[0].approved, true);
  assert.equal(reviews[0].severity, 'minor');
  assert.match(reviews[0].notes, /auto-approved/);
  assert.match(reviews[0].notes, /looks good to me/);
});

test('recordPlanReviewFallback is a no-op when a plan review already exists', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  await store.writePlan(ws.id, '# Plan');
  await store.createReview({
    workstreamId: ws.id,
    target: 'plan',
    notes: 'rejected',
    approved: false,
    stage: 'plan',
    severity: 'important',
  });

  await recordPlanReviewFallback(store, ws.id, 'should be ignored');

  const reviews = await store.listReviews(ws.id);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].approved, false);
  assert.equal(reviews[0].notes, 'rejected');
});

test('workerAgentSpawnBlocked when no plan exists', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });

  const blocked = await workerAgentSpawnBlocked(store, ws.id);
  assert.ok(blocked);
  assert.match(blocked!, /write_plan/);

  await store.writePlan(ws.id, '# Plan');
  assert.equal(await workerAgentSpawnBlocked(store, ws.id), undefined);
});

test('recordPlanReviewFallback clips very long reviewer output', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-spawn-guard-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  await store.writePlan(ws.id, '# Plan');

  const huge = 'x'.repeat(5_000);
  await recordPlanReviewFallback(store, ws.id, huge);

  const reviews = await store.listReviews(ws.id);
  assert.equal(reviews.length, 1);
  // 1500-char cap from the implementation, with a trailing ellipsis marker.
  assert.ok(reviews[0].notes.length < 2_000, 'notes should be clipped');
  assert.match(reviews[0].notes, /…/);
});
