import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUsage, type RunRecord } from '../storage/types.js';
import { extractFileOps } from './file-ops.js';

test('extractFileOps collects reads and edits', () => {
  const runs: RunRecord[] = [
    {
      id: 'r1',
      role: 'worker',
      task: 't',
      status: 'done',
      toolCalls: [
        { name: 'read_file', input: { path: 'src/a.ts' }, output: 'ok', at: 't1' },
        { name: 'edit_file', input: { path: 'src/b.ts' }, output: 'ok', at: 't2' },
      ],
      usage: emptyUsage(),
      createdAt: '1',
    },
  ];
  const ops = extractFileOps(runs);
  assert.deepEqual(ops.readFiles, ['src/a.ts']);
  assert.deepEqual(ops.modifiedFiles, ['src/b.ts']);
});
