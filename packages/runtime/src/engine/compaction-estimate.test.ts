import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUsage, type CompactionArtifact, type RunRecord } from '../storage/types.js';
import {
  estimateWorkstreamContextChars,
  recentRunsForDigest,
  runsToCompact,
} from './compaction-estimate.js';

function worker(id: string, outputSize: number): RunRecord {
  return {
    id,
    role: 'worker',
    task: 'implement',
    status: 'done',
    toolCalls: [
      {
        name: 'grep',
        input: { pattern: 'x' },
        output: 'o'.repeat(outputSize),
        at: `${id}-t`,
      },
    ],
    usage: emptyUsage(),
    createdAt: id,
    workstreamId: 'ws',
  };
}

test('runsToCompact keeps trailing keepRecent runs', () => {
  const runs = ['1', '2', '3', '4', '5'].map((id) => worker(id, 10));
  const compact = runsToCompact(runs, 2);
  assert.deepEqual(compact.map((r) => r.id), ['1', '2', '3']);
});

test('recentRunsForDigest respects compaction boundary', () => {
  const runs = ['1', '2', '3', '4'].map((id) => worker(id, 10));
  const compaction: CompactionArtifact = {
    summary: 'old history',
    updatedAt: 'now',
    compactedThroughRunId: '2',
    generation: 1,
  };
  const recent = recentRunsForDigest(runs, compaction, 2, 8);
  assert.deepEqual(recent.map((r) => r.id), ['3', '4']);
});

test('estimateWorkstreamContextChars grows with bulky runs', () => {
  const ws = { goal: 'fix bug', summary: 'working', title: 'task' };
  const small = estimateWorkstreamContextChars({
    workstream: ws,
    plan: null,
    runs: [worker('1', 100)],
    compaction: null,
    keepRecent: 2,
  });
  const large = estimateWorkstreamContextChars({
    workstream: ws,
    plan: null,
    runs: ['1', '2', '3', '4', '5'].map((id) => worker(id, 20_000)),
    compaction: null,
    keepRecent: 2,
  });
  assert.ok(large > small);
});
