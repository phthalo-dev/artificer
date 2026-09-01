import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { CodemodeCellStore } from '../codemode/cells.js';
import { DEFAULT_CODEMODE_LIMITS } from '../config.js';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { createExecuteTool } from './execute.js';
import {
  WAIT_EXECUTE_DEFAULT_YIELD_MS,
  createWaitExecuteTool,
} from './wait-execute.js';

type Segment = {
  ok: boolean;
  running?: boolean;
  cellId?: string;
  value?: unknown;
  error?: { kind: string; message: string };
  toolCalls?: string[];
};

function parse(raw: string): Segment {
  return JSON.parse(raw) as Segment;
}

function cellCtx(t: TestContext): ToolContext {
  const store = new CodemodeCellStore({ maxCells: 4, cellTtlMs: 120_000 });
  t.after(() => store.disposeRun('run_1'));
  return {
    engine: {
      config: { codemode: DEFAULT_CODEMODE_LIMITS },
    } as ToolContext['engine'],
    run: { id: 'run_1' } as ToolContext['run'],
    workspaceDir: '/tmp',
    codemodeCells: store,
  };
}

function pair(ctx: ToolContext): { execute: ToolDef; wait: ToolDef } {
  return {
    execute: createExecuteTool(ctx, [], DEFAULT_CODEMODE_LIMITS),
    wait: createWaitExecuteTool(ctx),
  };
}

test('wait_execute is named wait_execute', () => {
  const wait = createWaitExecuteTool({
    engine: { config: {} } as ToolContext['engine'],
    run: { id: 'run_1' } as ToolContext['run'],
    workspaceDir: '/tmp',
  });
  assert.equal(wait.name, 'wait_execute');
  assert.deepEqual(wait.inputSchema.required, ['cellId']);
});

test('WAIT_EXECUTE_DEFAULT_YIELD_MS is 10_000', () => {
  assert.equal(WAIT_EXECUTE_DEFAULT_YIELD_MS, 10_000);
});

test('wait_execute resumes a yielded cell to completion', async (t) => {
  const ctx = cellCtx(t);
  const { execute, wait } = pair(ctx);
  const first = parse(
    await execute.handler({
      code: `await yield_control(); return 'done';`,
    }),
  );
  assert.equal(first.ok, true);
  assert.equal(first.running, true);
  assert.equal(typeof first.cellId, 'string');

  const second = parse(await wait.handler({ cellId: first.cellId }));
  assert.equal(second.ok, true);
  assert.equal(second.running, false);
  assert.equal(second.value, 'done');
});

test('wait_execute keeps the completed payload until disposeRun', async (t) => {
  const ctx = cellCtx(t);
  const { execute, wait } = pair(ctx);
  const first = parse(
    await execute.handler({
      code: `await yield_control(); return { n: 7 };`,
    }),
  );
  assert.equal(first.running, true);
  const cellId = first.cellId!;

  const completed = parse(await wait.handler({ cellId }));
  assert.equal(completed.ok, true);
  assert.equal(completed.running, false);
  assert.deepEqual(completed.value, { n: 7 });
  assert.equal(
    ctx.codemodeCells?.get('run_1', cellId),
    undefined,
    'isolate should be freed on complete',
  );

  const again = parse(await wait.handler({ cellId }));
  assert.equal(again.ok, true);
  assert.equal(again.running, false);
  assert.deepEqual(again.value, { n: 7 });

  ctx.codemodeCells?.disposeRun('run_1');
  const after = parse(await wait.handler({ cellId }));
  assert.equal(after.ok, false);
  assert.equal(after.error?.kind, 'CellNotFound');
});

test('completed cells do not count toward maxCells', async (t) => {
  const ctx = cellCtx(t);
  const { execute, wait } = pair(ctx);
  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const segment = parse(
      await execute.handler({
        code: `await yield_control(); return ${i};`,
      }),
    );
    assert.equal(segment.running, true);
    ids.push(segment.cellId!);
  }

  const fifthWhileFull = parse(
    await execute.handler({
      code: `await yield_control(); return 'nope';`,
    }),
  );
  assert.equal(fifthWhileFull.ok, false);
  assert.equal(fifthWhileFull.error?.kind, 'CellLimitExceeded');

  const finished = parse(await wait.handler({ cellId: ids[0] }));
  assert.equal(finished.ok, true);
  assert.equal(finished.running, false);

  const replacement = parse(
    await execute.handler({
      code: `await yield_control(); return 'slot';`,
    }),
  );
  assert.equal(replacement.ok, true);
  assert.equal(replacement.running, true);

  const cached = parse(await wait.handler({ cellId: ids[0] }));
  assert.equal(cached.ok, true);
  assert.equal(cached.running, false);
  assert.equal(cached.value, 0);
});

test('wait_execute terminate forgets the cell; further wait is CellNotFound', async (t) => {
  const ctx = cellCtx(t);
  const { execute, wait } = pair(ctx);
  const first = parse(
    await execute.handler({
      code: `await yield_control(); return 'never';`,
    }),
  );
  const killed = parse(
    await wait.handler({ cellId: first.cellId, terminate: true }),
  );
  assert.equal(killed.ok, true);
  assert.equal(killed.running, false);
  assert.equal(killed.value, null);

  const after = parse(await wait.handler({ cellId: first.cellId }));
  assert.equal(after.ok, false);
  assert.equal(after.error?.kind, 'CellNotFound');
});

test('overlapping wait_execute is ExecutionFailure, not CellNotFound', async (t) => {
  const ctx = cellCtx(t);
  const slow: ToolDef = {
    name: 'slow',
    description: 'slow',
    inputSchema: { type: 'object', properties: {} },
    handler: () => new Promise<string>((r) => setTimeout(() => r('late'), 150)),
  };
  const execute = createExecuteTool(ctx, [slow], DEFAULT_CODEMODE_LIMITS);
  const wait = createWaitExecuteTool(ctx);
  const first = parse(
    await execute.handler({
      code: `await yield_control(); return await tools.slow({});`,
    }),
  );
  assert.equal(first.running, true);
  const cellId = first.cellId!;

  const inFlight = wait.handler({ cellId });
  const overlapping = parse(await wait.handler({ cellId }));
  assert.equal(overlapping.ok, false);
  assert.equal(overlapping.error?.kind, 'ExecutionFailure');
  assert.match(overlapping.error?.message ?? '', /already running a segment/);
  assert.ok(
    ctx.codemodeCells?.get('run_1', cellId),
    'cell must stay alive so the wait is retryable',
  );

  const settled = parse(await inFlight);
  assert.equal(settled.ok, true);
  assert.equal(settled.value, 'late');
});

test('wait_execute omitted yield_time_ms is not treated as zero', async (t) => {
  const ctx = cellCtx(t);
  const slow: ToolDef = {
    name: 'slow',
    description: 'slow',
    inputSchema: { type: 'object', properties: {} },
    handler: () => new Promise<string>((r) => setTimeout(() => r('late'), 180)),
  };
  const execute = createExecuteTool(ctx, [slow], DEFAULT_CODEMODE_LIMITS);
  const wait = createWaitExecuteTool(ctx);

  const first = parse(
    await execute.handler({
      code: `await yield_control(); return await tools.slow({});`,
    }),
  );
  assert.equal(first.running, true);

  const zero = parse(
    await wait.handler({ cellId: first.cellId, yield_time_ms: 0 }),
  );
  assert.equal(zero.ok, true);
  assert.equal(zero.running, true, '0 ms is an immediate soft yield');

  const omitted = parse(await wait.handler({ cellId: first.cellId }));
  assert.equal(omitted.ok, true);
  assert.equal(omitted.running, false);
  assert.equal(omitted.value, 'late');
});
