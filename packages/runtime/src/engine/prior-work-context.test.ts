import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPriorWorkContext } from './prior-work-context.js';
import type { RunRecord } from '../storage/types.js';
import { emptyUsage } from '../storage/types.js';

function makeRun(
  toolCalls: Array<{ name: string; input: unknown; error?: string }>,
): RunRecord {
  return {
    id: 'run_test',
    role: 'worker',
    task: 'implement',
    workstreamId: 'ws_test',
    status: 'done',
    toolCalls: toolCalls.map((t, i) => ({
      name: t.name,
      input: t.input,
      output: '',
      error: t.error,
      at: new Date(Date.now() + i * 1000).toISOString(),
    })),
    usage: emptyUsage(),
    createdAt: new Date().toISOString(),
  };
}

test('returns undefined when there are no prior worker runs', () => {
  assert.equal(buildPriorWorkContext([]), undefined);
});

test('includes report_status summary when worker called report_status', () => {
  const run = makeRun([
    {
      name: 'report_status',
      input: {
        status: 'done_with_concerns',
        summary: 'Created src/index.ts and jsx-runtime.ts',
      },
    },
  ]);
  const ctx = buildPriorWorkContext([run]);
  assert.ok(ctx, 'should return a context string');
  assert.match(ctx, /Created src\/index\.ts and jsx-runtime\.ts/);
});

test('lists written files when no report_status was called (budget exhaustion)', () => {
  const run = makeRun([
    { name: 'write_file', input: { path: 'packages/react/package.json' } },
    { name: 'write_file', input: { path: 'packages/react/src/styled.ts' } },
    { name: 'read_file', input: { path: 'some/other/file.ts' } },
  ]);
  const ctx = buildPriorWorkContext([run]);
  assert.ok(ctx);
  assert.match(ctx, /packages\/react\/package\.json/);
  assert.match(ctx, /packages\/react\/src\/styled\.ts/);
});

test('failed write_file calls are excluded from the file list', () => {
  const run = makeRun([
    { name: 'write_file', input: { path: 'packages/react/src/index.ts' } },
    {
      name: 'write_file',
      input: { path: 'packages/react/src/broken.ts' },
      error: 'permission denied',
    },
  ]);
  const ctx = buildPriorWorkContext([run]);
  assert.ok(ctx);
  assert.match(ctx, /packages\/react\/src\/index\.ts/);
  assert.ok(
    !ctx.includes('broken.ts'),
    'failed writes should not appear in the list',
  );
});

test('notes no changes when run made no writes and no report_status', () => {
  const run = makeRun([
    { name: 'read_file', input: { path: 'src/index.ts' } },
    { name: 'run_shell', input: { command: 'pnpm test' } },
  ]);
  const ctx = buildPriorWorkContext([run]);
  assert.ok(ctx);
  assert.match(ctx, /no changes/i);
});

test('includes a continue-from-here instruction', () => {
  const run = makeRun([{ name: 'write_file', input: { path: 'src/foo.ts' } }]);
  const ctx = buildPriorWorkContext([run]);
  assert.ok(ctx);
  assert.match(ctx, /continue from here/i);
});

test('numbers multiple prior runs in order', () => {
  const run1 = {
    ...makeRun([{ name: 'write_file', input: { path: 'a.ts' } }]),
    id: 'run_1',
  };
  const run2 = {
    ...makeRun([
      {
        name: 'report_status',
        input: { status: 'done', summary: 'finished b.ts' },
      },
    ]),
    id: 'run_2',
  };
  const ctx = buildPriorWorkContext([run1, run2]);
  assert.ok(ctx);
  assert.match(ctx, /Run 1/i);
  assert.match(ctx, /Run 2/i);
});
