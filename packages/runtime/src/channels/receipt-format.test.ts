import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatReceiptForChannel,
  wantsFullReceipt,
} from './receipt-format.js';
import type { WorkstreamReceipt } from '../engine/workstream-receipt.js';

const baseReceipt: WorkstreamReceipt = {
  schemaVersion: 1,
  id: 'receipt_ws_test',
  workstreamId: 'ws_test',
  title: 'Auth fix',
  goal: 'Fix the login bug',
  status: 'done',
  summary: 'Fixed token refresh and added regression coverage.',
  createdAt: '2026-09-23T10:00:00.000Z',
  updatedAt: '2026-09-23T11:00:00.000Z',
  steps: [
    {
      id: 'task_1',
      order: 1,
      role: 'worker',
      label: 'Fix login bug',
      status: 'done',
      runIds: ['run_1'],
      taskIds: ['task_1'],
    },
  ],
  changes: { files: ['src/auth.ts', 'src/auth.test.ts'] },
  validation: [
    {
      label: 'pnpm test auth',
      status: 'passed',
      command: 'pnpm test auth',
    },
  ],
  reviews: [
    {
      id: 'review_1',
      target: 'work',
      approved: true,
      summary: 'Approved.',
      sourceReviewId: 'review_1',
    },
  ],
  findings: [],
  usage: {
    runCount: 4,
    inputTokens: 1200,
    outputTokens: 600,
    modelRequests: 4,
    estimatedCostDollars: 0.0123,
  },
  links: { localUrl: '/workstreams/ws_test' },
  provenance: {
    sourceUpdatedAt: '2026-09-23T11:00:00.000Z',
    redactionPolicyVersion: 'v1',
  },
};

describe('formatReceiptForChannel', () => {
  it('returns a compact summary by default', () => {
    const text = formatReceiptForChannel(
      baseReceipt,
      '# Auth fix\n\nFull markdown body',
    );
    assert.match(text, /\*Auth fix\*/);
    assert.match(text, /Fixed token refresh/);
    assert.match(text, /1\/1 steps complete/);
    assert.match(text, /Changes: 2 file\(s\)/);
    assert.match(text, /Validation: 1 passed/);
    assert.doesNotMatch(text, /^# Auth fix/m);
  });

  it('returns full markdown when includeFullReceipt is set', () => {
    const text = formatReceiptForChannel(
      baseReceipt,
      '# Auth fix\n\nFull markdown body',
      {
        name: 'slack',
        metadata: {},
        includeFullReceipt: true,
      },
    );
    assert.match(text, /^# Auth fix/m);
    assert.match(text, /Full markdown body/);
  });

  it('detects full receipt requests in origin content', () => {
    assert.equal(wantsFullReceipt('please send the full receipt when done'), true);
    assert.equal(wantsFullReceipt('fix the auth bug'), false);
  });
});
