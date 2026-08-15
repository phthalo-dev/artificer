import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRunIndexEntry,
  rankRuns,
  TASK_EXCERPT_MAX,
  OUTPUT_EXCERPT_MAX,
  type RunIndexEntry,
} from './history-search.js';
import type { RunRecord } from './types.js';

function minimalRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run_1',
    role: 'worker',
    task: 'Fix the auth redirect loop in login.ts',
    status: 'done',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 0,
    },
    output: 'Replaced the stale session check with a fresh token lookup.',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('buildRunIndexEntry excerpts task and output, drops toolCalls/usage', () => {
  const run = minimalRun({
    toolCalls: [{ name: 'read_file', input: {}, output: 'x', at: 't' }],
    workstreamId: 'ws_1',
    model: 'gpt-5',
  });
  const entry = buildRunIndexEntry(run);
  assert.equal(entry.id, 'run_1');
  assert.equal(entry.role, 'worker');
  assert.equal(entry.status, 'done');
  assert.equal(entry.workstreamId, 'ws_1');
  assert.equal(entry.model, 'gpt-5');
  assert.equal(entry.taskExcerpt, 'Fix the auth redirect loop in login.ts');
  assert.equal(
    entry.outputExcerpt,
    'Replaced the stale session check with a fresh token lookup.',
  );
  assert.equal(entry.createdAt, '2026-01-01T00:00:00.000Z');
  assert.ok(!('toolCalls' in entry));
  assert.ok(!('usage' in entry));
});

test('buildRunIndexEntry truncates long task/output to the excerpt max lengths', () => {
  const run = minimalRun({
    task: 'x'.repeat(500),
    output: 'y'.repeat(500),
  });
  const entry = buildRunIndexEntry(run);
  assert.equal(entry.taskExcerpt.length, TASK_EXCERPT_MAX);
  assert.equal(entry.outputExcerpt.length, OUTPUT_EXCERPT_MAX);
});

test('buildRunIndexEntry falls back to error when output is empty on a failed run', () => {
  const run = minimalRun({
    status: 'failed',
    output: undefined,
    error: 'Tests failed: 2 assertions did not pass.',
  });
  const entry = buildRunIndexEntry(run);
  assert.equal(entry.status, 'failed');
  assert.equal(entry.outputExcerpt, 'Tests failed: 2 assertions did not pass.');
});

test('buildRunIndexEntry produces an empty outputExcerpt when neither output nor error is set', () => {
  const run = minimalRun({ output: undefined, error: undefined });
  const entry = buildRunIndexEntry(run);
  assert.equal(entry.outputExcerpt, '');
});

test('rankRuns: empty query returns all entries in recency order', () => {
  const entries: RunIndexEntry[] = [
    {
      id: 'a',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'older',
      outputExcerpt: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'b',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'newer',
      outputExcerpt: '',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const ranked = rankRuns('', entries);
  assert.deepEqual(
    ranked.map((r) => r.entry.id),
    ['b', 'a'],
  );
});

test('rankRuns: matches by task text and ranks the closer match first', () => {
  const entries: RunIndexEntry[] = [
    {
      id: 'auth-fix',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'Fix the auth redirect loop in login.ts',
      outputExcerpt: 'Replaced the stale session check.',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'unrelated',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'Update the changelog for the release',
      outputExcerpt: 'Bumped version and added notes.',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const ranked = rankRuns('auth redirect', entries);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].entry.id, 'auth-fix');
});

test('rankRuns: a query of only stopwords falls back to recency order', () => {
  const entries: RunIndexEntry[] = [
    {
      id: 'a',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'task a',
      outputExcerpt: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'b',
      role: 'worker',
      status: 'done',
      taskExcerpt: 'task b',
      outputExcerpt: '',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const ranked = rankRuns('the of', entries);
  assert.deepEqual(
    ranked.map((r) => r.entry.id),
    ['b', 'a'],
  );
});
