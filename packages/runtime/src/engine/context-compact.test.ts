import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPriorRunsDigest,
  CLEARED_TOOL_OUTPUT,
  COMPACTABLE_TOOLS,
} from './context-compact.js';
import type { Store } from '../storage/store.js';
import { emptyUsage, type RunRecord } from '../storage/types.js';

function mockStore(runs: RunRecord[]): Pick<Store, 'listRunsForWorkstream'> {
  return {
    listRunsForWorkstream: async () => runs,
  };
}

test('bulky grep output becomes cleared when microcompact enabled', async () => {
  const runs: RunRecord[] = [
    {
      id: 'run_a',
      role: 'worker',
      status: 'done',
      task: 't',
      toolCalls: [
        {
          name: 'grep',
          input: { pattern: 'foo' },
          output: 'x'.repeat(2000),
          at: '2026-06-01T00:00:00.000Z',
        },
      ],
      usage: emptyUsage(),
      createdAt: '2026-06-01T00:00:00.000Z',
      finishedAt: '2026-06-01T00:01:00.000Z',
      workstreamId: 'ws_1',
    },
  ];
  const digest = await buildPriorRunsDigest(
    mockStore(runs),
    'ws_1',
    'run_current',
    8,
    true,
  );
  assert.ok(digest);
  assert.ok(digest!.includes(CLEARED_TOOL_OUTPUT));
  assert.ok(!digest!.includes('x'.repeat(100)));
});

test('submit_review output preserved when not compactable', async () => {
  const runs: RunRecord[] = [
    {
      id: 'run_b',
      role: 'reviewer',
      status: 'done',
      task: 'review',
      toolCalls: [
        {
          name: 'submit_review',
          input: { approved: true },
          output: 'Approved with minor notes about naming.',
          at: '2026-06-01T00:02:00.000Z',
        },
      ],
      usage: emptyUsage(),
      createdAt: '2026-06-01T00:02:00.000Z',
      finishedAt: '2026-06-01T00:03:00.000Z',
      workstreamId: 'ws_1',
    },
  ];
  const digest = await buildPriorRunsDigest(
    mockStore(runs),
    'ws_1',
    undefined,
    8,
    true,
  );
  assert.ok(digest!.includes('Approved with minor notes'));
  assert.ok(!COMPACTABLE_TOOLS.has('submit_review'));
});

test('microcompact disabled keeps last two runs with clipped outputs', async () => {
  const runs: RunRecord[] = Array.from({ length: 4 }, (_, i) => ({
    id: `run_${i}`,
    role: 'worker' as const,
    status: 'done' as const,
    task: 't',
    toolCalls: [
      {
        name: 'grep',
        input: { pattern: `p${i}` },
        output: `output-${i}-${'y'.repeat(500)}`,
        at: `2026-06-01T00:0${i}:00.000Z`,
      },
    ],
    usage: emptyUsage(),
    createdAt: `2026-06-01T00:0${i}:00.000Z`,
    finishedAt: `2026-06-01T00:0${i}:30.000Z`,
    workstreamId: 'ws_1',
  }));
  const digest = await buildPriorRunsDigest(
    mockStore(runs),
    'ws_1',
    undefined,
    8,
    false,
  );
  assert.ok(digest);
  assert.ok(!digest!.includes('run_0'));
  assert.ok(!digest!.includes('run_1'));
  assert.ok(digest!.includes('run_2'));
  assert.ok(digest!.includes('run_3'));
  assert.ok(digest!.includes('output-2-'));
  assert.ok(!digest!.includes(CLEARED_TOOL_OUTPUT));
});
