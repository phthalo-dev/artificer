import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  WorkstreamReceiptService,
  buildReceiptSummaryTask,
} from './workstream-receipt.js';
import { Store } from '../storage/store.js';
import { TraceRecorder } from '../storage/trace-recorder.js';
import type { RunRecord } from '../storage/types.js';

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-receipt-'));
  const store = new Store(root);
  await store.init();
  const traceRecorder = new TraceRecorder(store.layout, 'test-agent');
  const receipts = new WorkstreamReceiptService(store, traceRecorder);
  return { root, store, receipts, traceRecorder };
}

test('refresh writes deterministic receipt.json and receipt.md', async () => {
  const { store, receipts } = await makeFixture();
  const ws = await store.createWorkstream({
    title: 'Receipt test',
    goal: 'Verify receipt generation',
    status: 'done',
    summary: 'Implemented the feature successfully.',
  });
  await store.writePlan(ws.id, '# Plan\n\n1. Ship receipts');
  const task = await store.createTask({
    workstreamId: ws.id,
    role: 'worker',
    description: 'Implement receipts',
    status: 'done',
  });
  await store.updateTask(ws.id, task.id, {
    result: 'Receipt generator added.',
  });

  const first = await receipts.refresh(ws.id);
  const second = await receipts.refresh(ws.id);
  assert.ok(first);
  assert.deepEqual(first!.receipt, second!.receipt);
  assert.equal(first!.markdown, second!.markdown);
  assert.equal(first!.receipt.schemaVersion, 1);
  assert.match(first!.markdown, /^# Receipt test/m);
  assert.match(first!.markdown, /Implemented the feature successfully/);
});

test('refresh redacts secrets from goal and summary fields', async () => {
  const { store, receipts } = await makeFixture();
  const ws = await store.createWorkstream({
    title: 'Secret handling',
    goal: 'Use token=supersecret and ghp_abc123def456',
    status: 'done',
    summary: 'Bearer abc.def.ghi in logs',
  });

  const result = await receipts.refresh(ws.id);
  assert.ok(result);
  assert.match(result!.receipt.goal, /\[REDACTED\]/);
  assert.doesNotMatch(result!.receipt.goal, /supersecret/);
  assert.match(result!.markdown, /\[REDACTED\]/);
});

test('refresh records validation commands from run_shell tool calls', async () => {
  const { store, receipts } = await makeFixture();
  const ws = await store.createWorkstream({
    title: 'Validated work',
    goal: 'Run tests',
    status: 'done',
  });
  const run: RunRecord = {
    id: 'run_test',
    role: 'worker',
    task: 'Run tests',
    status: 'done',
    workstreamId: ws.id,
    createdAt: '2026-09-23T10:00:00.000Z',
    toolCalls: [
      {
        name: 'run_shell',
        input: { command: 'pnpm test packages/runtime' },
        output: 'All tests passed',
      },
    ],
  };
  await store.saveRun(run);

  const result = await receipts.refresh(ws.id);
  assert.ok(result);
  assert.equal(result!.receipt.validation.length, 1);
  assert.equal(result!.receipt.validation[0]?.status, 'passed');
  assert.match(result!.receipt.validation[0]?.command ?? '', /pnpm test/);
});

test('ensureCurrent reuses cached receipt when source state is unchanged', async () => {
  const { store, receipts } = await makeFixture();
  const ws = await store.createWorkstream({
    title: 'Cached receipt',
    goal: 'Stay stable',
    status: 'in_progress',
  });
  await receipts.refresh(ws.id);
  const before = await fs.readFile(store.layout.receiptFile(ws.id), 'utf8');
  const cached = await receipts.ensureCurrent(ws.id);
  const after = await fs.readFile(store.layout.receiptFile(ws.id), 'utf8');
  assert.ok(cached);
  assert.equal(before, after);
});

test('applyGeneratedSummary updates summary and provenance', async () => {
  const { store, receipts } = await makeFixture();
  const ws = await store.createWorkstream({
    title: 'Summarized work',
    goal: 'Generate a polished summary',
    status: 'done',
  });
  await receipts.refresh(ws.id);

  const updated = await receipts.applyGeneratedSummary(
    ws.id,
    'Shipped a concise receipt with validation and usage details.',
    'run_summary',
  );
  assert.ok(updated);
  assert.match(
    updated!.receipt.summary,
    /Shipped a concise receipt with validation and usage details/,
  );
  assert.equal(updated!.receipt.provenance.generatedByRunId, 'run_summary');
  assert.match(updated!.markdown, /Shipped a concise receipt/);
});

test('buildReceiptSummaryTask includes bounded facts without raw tool output', () => {
  const task = buildReceiptSummaryTask({
    schemaVersion: 1,
    id: 'receipt_ws_test',
    workstreamId: 'ws_test',
    title: 'Summarized work',
    goal: 'Generate a polished summary',
    status: 'done',
    summary: 'Initial summary',
    createdAt: '2026-09-23T10:00:00.000Z',
    updatedAt: '2026-09-23T11:00:00.000Z',
    steps: [
      {
        id: 'task_1',
        order: 1,
        role: 'worker',
        label: 'Implement receipts',
        status: 'done',
        summary: 'Added receipt generator.',
        runIds: ['run_1'],
        taskIds: ['task_1'],
      },
    ],
    changes: {
      files: ['packages/runtime/src/engine/workstream-receipt.ts'],
      commits: [],
    },
    validation: [{ label: 'pnpm test', status: 'passed' }],
    reviews: [
      {
        id: 'review_1',
        target: 'work',
        approved: true,
        summary: 'Looks good.',
        sourceReviewId: 'review_1',
      },
    ],
    findings: [],
    usage: {
      runCount: 3,
      inputTokens: 1000,
      outputTokens: 500,
      modelRequests: 3,
    },
    links: { localUrl: '/workstreams/ws_test' },
    provenance: {
      sourceUpdatedAt: '2026-09-23T11:00:00.000Z',
      redactionPolicyVersion: 'v1',
    },
  });

  assert.match(task, /\[Facts\]/);
  assert.match(task, /Implement receipts/);
  assert.doesNotMatch(task, /toolCalls/);
});

test('refresh builds steps from tasks when present', async () => {
  const { store, receipts } = await makeFixture();
  const created = await store.createWorkstream({
    title: 'Steps test',
    goal: 'Build steps from tasks',
    status: 'done',
    summary: 'Done.',
  });
  const task = await store.createTask({
    workstreamId: created.id,
    role: 'worker',
    description: 'Implement feature',
    status: 'done',
  });
  await store.updateTask(created.id, task.id, {
    result: 'Feature implemented.',
  });

  const result = await receipts.refresh(created.id);
  assert.ok(result);
  assert.equal(result!.receipt.steps.length, 1);
  assert.equal(result!.receipt.steps[0]?.role, 'worker');
  assert.match(result!.receipt.steps[0]?.summary ?? '', /Feature implemented/);
});
