import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunRecord, ToolInvocation } from '../storage/types.js';
import { countNoProgressRepeats } from './worker-progress.js';

function toolCall(
  name: string,
  input: unknown,
  overrides: Partial<ToolInvocation> = {},
): ToolInvocation {
  return { name, input, output: '', at: 'now', ...overrides };
}

function reportStatus(status: string): ToolInvocation {
  return toolCall('report_status', { status, summary: 'x' });
}

function workerRun(at: string, toolCalls: ToolInvocation[] = []): RunRecord {
  return {
    id: `run_${at}`,
    role: 'worker',
    task: 't',
    status: 'done',
    toolCalls,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 1,
    },
    createdAt: at,
  };
}

test('no worker runs -> zero', () => {
  assert.equal(countNoProgressRepeats([]), 0);
});

test('a single run that made edits and reported done -> zero', () => {
  const runs = [
    workerRun('1', [
      toolCall('edit_file', { path: 'a.py', old: 'x', new: 'y' }),
      reportStatus('done'),
    ]),
  ];
  assert.equal(countNoProgressRepeats(runs), 0);
});

test('two consecutive runs that made no edits and never reported done -> 2', () => {
  const runs = [
    workerRun('1', [reportStatus('blocked')]),
    workerRun('2', [reportStatus('needs_context')]),
  ];
  assert.equal(countNoProgressRepeats(runs), 2);
});

test('a run with no edits that reports done is not counted as stuck', () => {
  const runs = [
    workerRun('1', [reportStatus('blocked')]),
    workerRun('2', [reportStatus('done')]),
  ];
  assert.equal(countNoProgressRepeats(runs), 0);
});

test('two consecutive runs making the exact same edit -> 2 (thrash loop)', () => {
  const edit = toolCall('edit_file', {
    path: 'a.py',
    old: 'foo',
    new: 'bar',
  });
  const runs = [
    workerRun('1', [edit, reportStatus('blocked')]),
    workerRun('2', [edit, reportStatus('blocked')]),
  ];
  assert.equal(countNoProgressRepeats(runs), 2);
});

test('runs making different edits each time are progress, not a repeat', () => {
  const runs = [
    workerRun('1', [
      toolCall('edit_file', { path: 'a.py', old: 'foo', new: 'bar' }),
      reportStatus('blocked'),
    ]),
    workerRun('2', [
      toolCall('edit_file', { path: 'b.py', old: 'baz', new: 'qux' }),
      reportStatus('blocked'),
    ]),
  ];
  assert.equal(countNoProgressRepeats(runs), 0);
});

test('an edit followed by no-edit runs eventually counts the trailing stuck runs', () => {
  const runs = [
    workerRun('1', [
      toolCall('edit_file', { path: 'a.py', old: 'foo', new: 'bar' }),
      reportStatus('blocked'),
    ]),
    workerRun('2', [reportStatus('blocked')]),
    workerRun('3', [reportStatus('needs_context')]),
  ];
  assert.equal(countNoProgressRepeats(runs), 2);
});

test('a failed edit_file call does not count as an edit', () => {
  const runs = [
    workerRun('1', [
      toolCall(
        'edit_file',
        { path: 'a.py', old: 'x', new: 'y' },
        { error: 'no match' },
      ),
      reportStatus('blocked'),
    ]),
    workerRun('2', [
      toolCall(
        'edit_file',
        { path: 'a.py', old: 'x', new: 'y' },
        { error: 'no match' },
      ),
      reportStatus('blocked'),
    ]),
  ];
  assert.equal(countNoProgressRepeats(runs), 2);
});

test('failed runs are not counted toward the trailing streak', () => {
  const runs = [
    workerRun('1', [reportStatus('blocked')]),
    { ...workerRun('2', []), status: 'failed' as const },
  ];
  // Only the one 'done' run is considered, so the streak is 1, not 2.
  assert.equal(countNoProgressRepeats(runs), 1);
});
