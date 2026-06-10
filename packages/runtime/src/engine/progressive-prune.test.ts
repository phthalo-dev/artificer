import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUsage, type RunRecord } from '../storage/types.js';
import { pickPruneLevelForBudget, serializeRunsForSummary } from './progressive-prune.js';

function runWithGrep(id: string, output: string): RunRecord {
  return {
    id,
    role: 'worker',
    task: 't',
    status: 'done',
    toolCalls: [
      { name: 'grep', input: { pattern: 'x' }, output, at: `${id}-t` },
    ],
    usage: emptyUsage(),
    createdAt: id,
  };
}

test('serializeRunsForSummary clears more output at higher prune levels', () => {
  const runs = [runWithGrep('1', 'a'.repeat(500)), runWithGrep('2', 'b'.repeat(500))];
  const low = serializeRunsForSummary(runs, 0);
  const high = serializeRunsForSummary(runs, 4);
  assert.ok(low.includes('aaa'));
  assert.ok(high.includes('[tool output pruned for summarization]'));
});

test('pickPruneLevelForBudget finds a level within max chars', () => {
  const runs = Array.from({ length: 6 }, (_, i) => runWithGrep(String(i), 'z'.repeat(2_000)));
  const level = pickPruneLevelForBudget(runs, 4_000);
  assert.ok(serializeRunsForSummary(runs, level).length <= 4_000);
});
