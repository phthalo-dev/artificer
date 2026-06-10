import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunRecord } from '../storage/types.js';
import { detectCrossRunToolRepetition } from './cross-run-loop.js';

function workerRun(
  id: string,
  toolCalls: RunRecord['toolCalls'],
): RunRecord {
  return {
    id,
    role: 'worker',
    task: 't',
    status: 'done',
    toolCalls,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 1,
    },
    createdAt: id,
  };
}

test('detectCrossRunToolRepetition flags trailing identical calls across runs', () => {
  const runs = [
    workerRun('1', [
      { name: 'read_file', input: { path: 'a.ts' }, output: 'x', at: 't1' },
    ]),
    workerRun('2', [
      { name: 'read_file', input: { path: 'a.ts' }, output: 'x', at: 't2' },
      { name: 'read_file', input: { path: 'a.ts' }, output: 'x', at: 't3' },
      { name: 'read_file', input: { path: 'a.ts' }, output: 'x', at: 't4' },
      { name: 'read_file', input: { path: 'a.ts' }, output: 'x', at: 't5' },
      { name: 'read_file', input: { path: 'a.ts' }, output: 'x', at: 't6' },
    ]),
  ];
  const hit = detectCrossRunToolRepetition(runs, 5);
  assert.ok(hit);
  assert.equal(hit!.toolName, 'read_file');
  assert.equal(hit!.count, 5);
});

test('detectCrossRunToolRepetition ignores different tool args', () => {
  const runs = [
    workerRun('1', [
      { name: 'read_file', input: { path: 'a.ts' }, output: 'x', at: 't1' },
      { name: 'read_file', input: { path: 'b.ts' }, output: 'x', at: 't2' },
    ]),
  ];
  assert.equal(detectCrossRunToolRepetition(runs, 3), null);
});
