import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPriorRunsDigest,
  clipDiff,
  COMPACTABLE_TOOLS,
  MAX_DIFF_CHARS,
  summarizeToolResult,
} from './context-compact.js';
import type { Store } from '../storage/store.js';
import { emptyUsage, type RunRecord, type ToolInvocation } from '../storage/types.js';

function mockStore(runs: RunRecord[]): Pick<Store, 'listRunsForWorkstream'> {
  return {
    listRunsForWorkstream: async () => runs,
  };
}

function inv(name: string, output: string): ToolInvocation {
  return { name, input: {}, output, at: '2026-06-01T00:00:00.000Z' };
}

test('summarizeToolResult: read_file reports a line count', () => {
  assert.equal(summarizeToolResult(inv('read_file', 'a\nb\nc')), '3 lines');
});

test('summarizeToolResult: run_shell reports ok and a line count on success', () => {
  assert.equal(
    summarizeToolResult(inv('run_shell', 'line1\nline2')),
    'ok, 2 lines output',
  );
});

test('summarizeToolResult: run_shell reports failed for a failed command', () => {
  assert.equal(
    summarizeToolResult(inv('run_shell', 'Command failed:\nboom')),
    'failed, 2 lines output',
  );
});

test('summarizeToolResult: run_shell reports failed for a timed-out command', () => {
  assert.equal(
    summarizeToolResult(
      inv('run_shell', 'Command timed out after 1000ms and was killed.'),
    ),
    'failed, 1 lines output',
  );
});

test('summarizeToolResult: grep reports a match count', () => {
  assert.equal(
    summarizeToolResult(inv('grep', 'src/a.ts:1:foo\nsrc/b.ts:2:foo')),
    '2 matches',
  );
});

test('summarizeToolResult: grep with no matches reports zero', () => {
  assert.equal(summarizeToolResult(inv('grep', '(no matches)')), '0 matches');
});

test('summarizeToolResult: glob reports a match count', () => {
  assert.equal(summarizeToolResult(inv('glob', 'a.ts\nb.ts\nc.ts')), '3 matches');
});

test('summarizeToolResult: fetch_url reports a character count', () => {
  assert.equal(summarizeToolResult(inv('fetch_url', 'hello')), '5 chars');
});

test('summarizeToolResult: unrecognized tool falls back to clipped raw output', () => {
  assert.equal(
    summarizeToolResult(inv('some_other_tool', 'short output')),
    'short output',
  );
});

test('clipDiff: returns short diffs unchanged', () => {
  assert.equal(clipDiff('diff --git a/x b/x'), 'diff --git a/x b/x');
});

test('clipDiff: truncates diffs over the cap with a marker', () => {
  const diff = 'x'.repeat(MAX_DIFF_CHARS + 100);
  const clipped = clipDiff(diff);
  assert.equal(clipped, `${'x'.repeat(MAX_DIFF_CHARS)}\n… (diff truncated)`);
});

test('clipDiff: respects a custom max', () => {
  assert.equal(clipDiff('a'.repeat(20), 10), `${'a'.repeat(10)}\n… (diff truncated)`);
});

test('bulky grep output becomes a one-line match-count summary when microcompact enabled', async () => {
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
          output: Array.from({ length: 20 }, (_, i) => `src/file${i}.ts:1:foo`).join(
            '\n',
          ),
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
  assert.ok(digest!.includes('20 matches'));
  assert.ok(!digest!.includes('src/file0.ts'));
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
  assert.ok(!digest!.includes('matches'));
});
