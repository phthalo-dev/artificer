import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunRecord, ToolInvocation } from '../storage/types.js';
import {
  lastWorkerReport,
  workerRunDone,
  workerRunSummary,
} from './worker-report.js';

function toolCall(
  name: string,
  input: unknown,
  overrides: Partial<ToolInvocation> = {},
): ToolInvocation {
  return { name, input, output: '', at: 'now', ...overrides };
}

function workerRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run_1',
    role: 'worker',
    task: 't',
    status: 'done',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 1,
    },
    createdAt: '1',
    ...overrides,
  };
}

test('lastWorkerReport returns undefined when report_status was never called', () => {
  const run = workerRun({ output: 'DONE\nfixed it' });
  assert.equal(lastWorkerReport(run), undefined);
});

test('lastWorkerReport returns the recorded status and summary', () => {
  const run = workerRun({
    toolCalls: [
      toolCall('report_status', {
        status: 'done',
        summary: 'Fixed the off-by-one in foo.ts',
      }),
    ],
  });
  assert.deepEqual(lastWorkerReport(run), {
    status: 'done',
    summary: 'Fixed the off-by-one in foo.ts',
    followUps: undefined,
  });
});

test('lastWorkerReport ignores a failed report_status call', () => {
  const run = workerRun({
    toolCalls: [
      toolCall(
        'report_status',
        { status: 'done', summary: 'x' },
        { error: 'bad input' },
      ),
    ],
  });
  assert.equal(lastWorkerReport(run), undefined);
});

test('lastWorkerReport uses the last successful call when there are several', () => {
  const run = workerRun({
    toolCalls: [
      toolCall('report_status', { status: 'needs_context', summary: 'first' }),
      toolCall('report_status', { status: 'done', summary: 'second' }),
    ],
  });
  assert.equal(lastWorkerReport(run)?.status, 'done');
  assert.equal(lastWorkerReport(run)?.summary, 'second');
});

test('lastWorkerReport ignores an unrecognized status value', () => {
  const run = workerRun({
    toolCalls: [
      toolCall('report_status', { status: 'finished', summary: 'x' }),
    ],
  });
  assert.equal(lastWorkerReport(run), undefined);
});

test('workerRunDone is true for done and done_with_concerns reports', () => {
  assert.equal(
    workerRunDone(
      workerRun({
        toolCalls: [toolCall('report_status', { status: 'done', summary: 'x' })],
      }),
    ),
    true,
  );
  assert.equal(
    workerRunDone(
      workerRun({
        toolCalls: [
          toolCall('report_status', {
            status: 'done_with_concerns',
            summary: 'x',
          }),
        ],
      }),
    ),
    true,
  );
});

test('workerRunDone is false for blocked and needs_context reports', () => {
  assert.equal(
    workerRunDone(
      workerRun({
        toolCalls: [
          toolCall('report_status', { status: 'blocked', summary: 'x' }),
        ],
      }),
    ),
    false,
  );
  assert.equal(
    workerRunDone(
      workerRun({
        toolCalls: [
          toolCall('report_status', { status: 'needs_context', summary: 'x' }),
        ],
      }),
    ),
    false,
  );
});

test('workerRunDone falls back to a line-anchored DONE in the run output', () => {
  assert.equal(workerRunDone(workerRun({ output: 'DONE\nAll tests pass.' })), true);
  assert.equal(
    workerRunDone(workerRun({ output: 'DONE_WITH_CONCERNS\nSee notes.' })),
    true,
  );
});

test('workerRunDone does not false-positive on "NOT DONE" in the output', () => {
  assert.equal(
    workerRunDone(workerRun({ output: 'NOT DONE — still need to fix the test.' })),
    false,
  );
});

test('workerRunDone is false when the run made no report and has no status line', () => {
  assert.equal(
    workerRunDone(workerRun({ output: 'I made some changes but ran out of time.' })),
    false,
  );
});

test('workerRunSummary formats the status and summary, with follow-ups when present', () => {
  const run = workerRun({
    toolCalls: [
      toolCall('report_status', {
        status: 'done_with_concerns',
        summary: 'Implemented the fix.',
        followUps: 'Consider adding a regression test.',
      }),
    ],
  });
  assert.equal(
    workerRunSummary(run),
    '[DONE_WITH_CONCERNS] Implemented the fix.\nFollow-ups: Consider adding a regression test.',
  );
});

test('workerRunSummary omits the follow-ups line when absent', () => {
  const run = workerRun({
    toolCalls: [
      toolCall('report_status', { status: 'done', summary: 'Implemented the fix.' }),
    ],
  });
  assert.equal(workerRunSummary(run), '[DONE] Implemented the fix.');
});

test('workerRunSummary returns undefined when report_status was never called', () => {
  assert.equal(workerRunSummary(workerRun({ output: 'DONE' })), undefined);
});
