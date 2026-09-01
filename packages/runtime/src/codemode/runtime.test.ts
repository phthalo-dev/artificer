import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DEFAULT_CODEMODE_LIMITS } from '../config.js';
import { CodemodeCellStore } from './cells.js';
import {
  resumeCodemodeCell,
  runCodemode,
  startCodemodeCell,
  type CodemodeSegmentResult,
  type CodemodeTool,
} from './runtime.js';

const limits = {
  ...DEFAULT_CODEMODE_LIMITS,
  timeoutMs: 5_000,
};

function tool(name: string, handler: CodemodeTool['handler']): CodemodeTool {
  return { name, handler };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let runCounter = 0;

/** A store plus run id, torn down after the test so no isolate outlives it. */
function cellFixture(
  t: TestContext,
  opts: { maxCells?: number; cellTtlMs?: number } = {},
): { store: CodemodeCellStore; runId: string } {
  const store = new CodemodeCellStore({
    maxCells: opts.maxCells ?? 4,
    cellTtlMs: opts.cellTtlMs ?? 120_000,
  });
  const runId = `run-${++runCounter}`;
  t.after(() => store.disposeRun(runId));
  return { store, runId };
}

function runningCellId(segment: CodemodeSegmentResult): string {
  assert.equal(segment.ok, true);
  assert.equal(segment.ok && segment.running, true);
  if (!segment.ok || !segment.running) throw new Error('not running');
  assert.equal(typeof segment.cellId, 'string');
  return segment.cellId;
}

test('empty code is ParseError', async () => {
  const result = await runCodemode({ code: '  ', tools: [], limits });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'ParseError');
});

test('syntax error is ParseError', async () => {
  const result = await runCodemode({ code: 'function {', tools: [], limits });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'ParseError');
});

test('undefined return becomes null', async () => {
  const result = await runCodemode({
    code: 'const x = 1;',
    tools: [],
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, null);
});

test('sequential tool calls see prior results', async () => {
  const tools = [
    tool('echo', async (input) => String(input.v)),
    tool('wrap', async (input) => `(${input.v})`),
  ];
  const result = await runCodemode({
    code: `
      const a = await tools.echo({ v: 'hi' });
      const b = await tools.wrap({ v: a });
      return b;
    `,
    tools,
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, '(hi)');
    assert.deepEqual(result.toolCalls, ['echo', 'wrap']);
  }
});

test('Promise.all runs tools concurrently', async () => {
  const wait = (ms: number) =>
    new Promise<string>((r) => setTimeout(() => r('ok'), ms));
  const tools = [
    tool('a', async () => wait(80)),
    tool('b', async () => wait(80)),
  ];
  const start = Date.now();
  const result = await runCodemode({
    code: `return await Promise.all([tools.a({}), tools.b({})]);`,
    tools,
    limits,
  });
  const elapsed = Date.now() - start;
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, ['ok', 'ok']);
  assert.ok(elapsed < 140, `expected overlap, took ${elapsed}ms`);
});

test('ninth concurrent call waits rather than failing', async () => {
  const tools = Array.from({ length: 9 }, (_, i) =>
    tool(`t${i}`, async () => {
      await new Promise((r) => setTimeout(r, 50));
      return String(i);
    }),
  );
  const names = tools.map((t) => `tools.${t.name}({})`).join(', ');
  const start = Date.now();
  const result = await runCodemode({
    code: `return await Promise.all([${names}]);`,
    tools,
    limits,
  });
  const elapsed = Date.now() - start;
  assert.equal(result.ok, true);
  assert.ok(
    elapsed >= 90,
    `9th call should wait for a slot, took ${elapsed}ms`,
  );
  assert.ok(elapsed < 250, `should still be two waves, took ${elapsed}ms`);
});

test('exceeding maxToolCalls is ToolCallLimitExceeded', async () => {
  const tools = [tool('n', async () => 'x')];
  const result = await runCodemode({
    code: `
      await tools.n({});
      await tools.n({});
      await tools.n({});
      return 1;
    `,
    tools,
    limits: { ...limits, maxToolCalls: 2 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'ToolCallLimitExceeded');
  assert.deepEqual(result.toolCalls, ['n', 'n']);
});

test('unsafe tool input is catchable and does not count toward maxToolCalls', async () => {
  const tools = [tool('n', async () => 'x')];
  const result = await runCodemode({
    code: `
      try { await tools.n(1n); } catch (e) {}
      await tools.n({});
      await tools.n({});
      return 1;
    `,
    tools,
    limits: { ...limits, maxToolCalls: 2 },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 1);
  assert.deepEqual(result.toolCalls, ['n', 'n']);
});

test('tight loop hits TimeoutExceeded', async () => {
  const result = await runCodemode({
    code: 'while (true) {}',
    tools: [],
    limits: { ...limits, timeoutMs: 50 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'TimeoutExceeded');
});

test('slow tool hits TimeoutExceeded', async () => {
  const tools = [
    tool(
      'slow',
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)),
    ),
  ];
  const result = await runCodemode({
    code: 'return await tools.slow({});',
    tools,
    limits: { ...limits, timeoutMs: 50 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'TimeoutExceeded');
});

test('oversize return is ok with truncated true', async () => {
  const result = await runCodemode({
    code: `
      console.log('y'.repeat(1000));
      return 'x'.repeat(1000);
    `,
    tools: [],
    limits: { ...limits, maxOutputBytes: 50 },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.truncated, true);
    const encoded = Buffer.byteLength(
      JSON.stringify({ value: result.value, logs: result.logs ?? [] }),
      'utf8',
    );
    assert.ok(encoded <= 50, `expected at most 50 bytes, got ${encoded}`);
  }
});

test('oversize failure is capped and remains a failure', async () => {
  const maxOutputBytes = 120;
  const result = await runCodemode({
    code: `
      console.log('l'.repeat(1000));
      throw new Error('e'.repeat(1000));
    `,
    tools: [],
    limits: { ...limits, maxOutputBytes },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.truncated, true);
    const encoded = Buffer.byteLength(
      JSON.stringify({ error: result.error, logs: result.logs ?? [] }),
      'utf8',
    );
    assert.ok(
      encoded <= maxOutputBytes,
      `expected at most ${maxOutputBytes} bytes, got ${encoded}`,
    );
  }
});

test('unknown tool is catchable; uncaught is ExecutionFailure', async () => {
  const caught = await runCodemode({
    code: `
      try { await tools.nope({}); }
      catch (e) { return 'caught'; }
    `,
    tools: [],
    limits,
  });
  assert.equal(caught.ok, true);
  if (caught.ok) assert.equal(caught.value, 'caught');

  const uncaught = await runCodemode({
    code: `await tools.nope({}); return 1;`,
    tools: [],
    limits,
  });
  assert.equal(uncaught.ok, false);
  if (!uncaught.ok) {
    assert.equal(uncaught.error.kind, 'ExecutionFailure');
    assert.match(uncaught.error.message, /nope/);
    assert.doesNotMatch(uncaught.error.message, /\/Users\//);
  }
});

test('missing tool properties are undefined and tools is awaitable', async () => {
  const result = await runCodemode({
    code: `
      const awaited = await tools;
      return {
        missingType: typeof tools.nope,
        awaitedSameObject: awaited === tools,
      };
    `,
    tools: [],
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      missingType: 'undefined',
      awaitedSameObject: true,
    });
  }
});

test('inner handler reject is catchable', async () => {
  const tools = [
    tool('boom', async () => {
      throw new Error('nope');
    }),
  ];
  const result = await runCodemode({
    code: `
      try { await tools.boom({}); }
      catch (e) { return e.message; }
    `,
    tools,
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'nope');
});

test('guest has no process, require, or fs', async () => {
  const result = await runCodemode({
    code: `
      return {
        process: typeof process,
        require: typeof require,
        fs: typeof fs,
      };
    `,
    tools: [],
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      process: 'undefined',
      require: 'undefined',
      fs: 'undefined',
    });
  }
});

test('returning a function is InvalidDataValue', async () => {
  const result = await runCodemode({
    code: 'return function () {};',
    tools: [],
    limits,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'InvalidDataValue');
});

test('returning a cycle is InvalidDataValue', async () => {
  const result = await runCodemode({
    code: `
      const value = {};
      value.self = value;
      return value;
    `,
    tools: [],
    limits,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'InvalidDataValue');
});

test('mutating tool args does not mutate the host object', async () => {
  const seen: unknown[] = [];
  const host = { n: 1 };
  const tools = [
    tool('take', async (input) => {
      seen.push(input);
      return 'ok';
    }),
  ];
  await runCodemode({
    code: `
      const a = { n: 1 };
      await tools.take(a);
      a.n = 2;
      return a.n;
    `,
    tools,
    limits,
  });
  assert.deepEqual(seen[0], { n: 1 });
  assert.notEqual(seen[0], host);
});

test('console.log appears in logs', async () => {
  const result = await runCodemode({
    code: `console.log('hi', 1); return 2;`,
    tools: [],
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, 2);
    assert.ok(result.logs?.some((l) => l.includes('hi')));
  }
});

test('onToolCall fires for inner success and error', async () => {
  const seen: string[] = [];
  const tools = [
    tool('ok', async () => 'yes'),
    tool('bad', async () => {
      throw new Error('x');
    }),
  ];
  await runCodemode({
    code: `
      await tools.ok({});
      try { await tools.bad({}); } catch (e) {}
      return 1;
    `,
    tools,
    limits,
    onToolCall: (inv) => seen.push(`${inv.name}:${inv.error ?? 'ok'}`),
  });
  assert.deepEqual(seen, ['ok:ok', 'bad:x']);
});

test('yield_control returns running with a live cellId', async (t) => {
  const { store, runId } = cellFixture(t);
  const segment = await startCodemodeCell({
    code: `await yield_control(); return 'done';`,
    tools: [],
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(segment);
  assert.ok(store.get(runId, cellId), 'cell should still be alive after yield');
});

test('resume completes and sees state written with store/load', async (t) => {
  const { store, runId } = cellFixture(t);
  const first = await startCodemodeCell({
    code: `
      store('k', { n: 1 });
      await yield_control();
      return load('k');
    `,
    tools: [],
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(first);
  assert.deepEqual(store.kv(runId).get('k'), { n: 1 });

  const second = await resumeCodemodeCell({ store, runId, cellId });
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.running, false);
    if (!second.running) assert.deepEqual(second.value, { n: 1 });
  }
  assert.equal(store.get(runId, cellId), undefined, 'cell freed on complete');
});

test('load returns undefined for a missing key', async (t) => {
  const { store, runId } = cellFixture(t);
  const segment = await startCodemodeCell({
    code: `return typeof load('nope');`,
    tools: [],
    limits,
    store,
    runId,
  });
  assert.equal(segment.ok, true);
  if (segment.ok && !segment.running) assert.equal(segment.value, 'undefined');
});

test('an uncaught store violation is InvalidDataValue', async (t) => {
  const { store, runId } = cellFixture(t);
  const segment = await startCodemodeCell({
    code: `store('k', function () {}); return 1;`,
    tools: [],
    limits,
    store,
    runId,
  });
  assert.equal(segment.ok, false);
  if (!segment.ok) assert.equal(segment.error.kind, 'InvalidDataValue');
});

test('a caught store violation lets the cell yield and finish', async (t) => {
  const { store, runId } = cellFixture(t);
  const first = await startCodemodeCell({
    code: `
      let caught = '';
      try { store('bad', function () {}); } catch (e) { caught = e.message; }
      store('ok', 1);
      await yield_control();
      return { caught, ok: load('ok'), bad: typeof load('bad') };
    `,
    tools: [],
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(first);

  const second = await resumeCodemodeCell({ store, runId, cellId });
  assert.equal(second.ok, true);
  if (second.ok && !second.running) {
    assert.deepEqual(second.value, {
      caught: 'store("bad") value is not JSON-safe',
      ok: 1,
      bad: 'undefined',
    });
  }
});

test('run KV is shared by later cells in the same run', async (t) => {
  const { store, runId } = cellFixture(t);
  const writer = await startCodemodeCell({
    code: `store('shared', 'hello'); return 1;`,
    tools: [],
    limits,
    store,
    runId,
  });
  assert.equal(writer.ok, true);

  const reader = await startCodemodeCell({
    code: `return load('shared');`,
    tools: [],
    limits,
    store,
    runId,
  });
  assert.equal(reader.ok, true);
  if (reader.ok && !reader.running) assert.equal(reader.value, 'hello');
});

test('pragma soft yield returns while a tool is in flight; resume finishes', async (t) => {
  const { store, runId } = cellFixture(t);
  const tools = [
    tool(
      'slow',
      () => new Promise<string>((r) => setTimeout(() => r('late'), 200)),
    ),
  ];
  const startedAt = Date.now();
  const first = await startCodemodeCell({
    code: `// @exec: {"yield_time_ms": 50}\nreturn await tools.slow({});`,
    tools,
    limits,
    store,
    runId,
  });
  const elapsed = Date.now() - startedAt;
  const cellId = runningCellId(first);
  assert.deepEqual(first.toolCalls, ['slow']);
  assert.ok(elapsed < 150, `expected a soft yield, took ${elapsed}ms`);

  const second = await resumeCodemodeCell({ store, runId, cellId });
  assert.equal(second.ok, true);
  if (second.ok && !second.running) assert.equal(second.value, 'late');
  assert.equal(store.get(runId, cellId), undefined);
});

test('invalid pragma JSON is ParseError before the program runs', async (t) => {
  const { store, runId } = cellFixture(t);
  const segment = await startCodemodeCell({
    code: `// @exec: {yield_time_ms: 50}\nglobalThis.ran = true; return 1;`,
    tools: [],
    limits,
    store,
    runId,
  });
  assert.equal(segment.ok, false);
  if (!segment.ok) assert.equal(segment.error.kind, 'ParseError');
});

test('hard timeoutMs spans segments and disposes the cell', async (t) => {
  const { store, runId } = cellFixture(t, { cellTtlMs: 120_000 });
  const first = await startCodemodeCell({
    code: `await yield_control(); return 1;`,
    tools: [],
    limits: { ...limits, timeoutMs: 200 },
    store,
    runId,
  });
  const cellId = runningCellId(first);

  await sleep(260);
  const second = await resumeCodemodeCell({ store, runId, cellId });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error.kind, 'TimeoutExceeded');
  assert.equal(store.get(runId, cellId), undefined);

  const third = await resumeCodemodeCell({ store, runId, cellId });
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.error.kind, 'CellNotFound');
});

test('terminate completes with null and forgets the cell', async (t) => {
  const { store, runId } = cellFixture(t);
  const first = await startCodemodeCell({
    code: `await yield_control(); return 'never';`,
    tools: [],
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(first);

  const second = await resumeCodemodeCell({
    store,
    runId,
    cellId,
    terminate: true,
  });
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.running, false);
    if (!second.running) assert.equal(second.value, null);
  }

  const third = await resumeCodemodeCell({ store, runId, cellId });
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.error.kind, 'CellNotFound');
});

test('a second resume is refused while a segment is in flight', async (t) => {
  const { store, runId } = cellFixture(t);
  const tools = [
    tool(
      'slow',
      () => new Promise<string>((r) => setTimeout(() => r('late'), 150)),
    ),
  ];
  const first = await startCodemodeCell({
    code: `await yield_control(); return await tools.slow({});`,
    tools,
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(first);

  const inFlight = resumeCodemodeCell({ store, runId, cellId });
  const overlapping = await resumeCodemodeCell({ store, runId, cellId });
  assert.equal(overlapping.ok, false);
  if (!overlapping.ok) {
    assert.equal(overlapping.error.kind, 'ExecutionFailure');
    assert.match(overlapping.error.message, /already running a segment/);
  }

  const settled = await inFlight;
  assert.equal(settled.ok, true);
  if (settled.ok && !settled.running) assert.equal(settled.value, 'late');
});

test('terminate is refused while a segment is in flight', async (t) => {
  const { store, runId } = cellFixture(t);
  const tools = [
    tool(
      'slow',
      () => new Promise<string>((r) => setTimeout(() => r('late'), 150)),
    ),
  ];
  const first = await startCodemodeCell({
    code: `await yield_control(); return await tools.slow({});`,
    tools,
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(first);

  const inFlight = resumeCodemodeCell({ store, runId, cellId });
  const killed = await resumeCodemodeCell({
    store,
    runId,
    cellId,
    terminate: true,
  });
  assert.equal(killed.ok, false);
  if (!killed.ok) assert.equal(killed.error.kind, 'ExecutionFailure');

  const settled = await inFlight;
  assert.equal(settled.ok, true);
});

test('TTL sweep does not dispose a cell that is driving a segment', async (t) => {
  const ttl = 50;
  const { store, runId } = cellFixture(t, { cellTtlMs: ttl });
  const tools = [
    tool(
      'slow',
      () => new Promise<string>((r) => setTimeout(() => r('late'), 150)),
    ),
  ];
  const first = await startCodemodeCell({
    code: `await yield_control(); return await tools.slow({});`,
    tools,
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(first);
  const cell = store.get(runId, cellId);
  assert.ok(cell);

  const inFlight = resumeCodemodeCell({ store, runId, cellId });
  assert.equal(store.get(runId, cellId)?.busy, true);

  // Parallel execute admits by sweeping first — the race Bugbot flagged.
  store.admit(runId, cell.createdAt + ttl);
  assert.equal(store.get(runId, cellId)?.vm.alive, true);

  const settled = await inFlight;
  assert.equal(settled.ok, true);
  if (settled.ok && !settled.running) assert.equal(settled.value, 'late');
});

test('TTL sweep disposes an idle yielded cell past max age', async (t) => {
  const ttl = 50;
  const { store, runId } = cellFixture(t, { cellTtlMs: ttl });
  const first = await startCodemodeCell({
    code: `await yield_control(); return 1;`,
    tools: [],
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(first);
  const cell = store.get(runId, cellId);
  assert.ok(cell);
  assert.equal(cell.busy, false);

  store.disposeExpired(cell.createdAt + ttl);
  assert.equal(store.get(runId, cellId), undefined);
  assert.equal(cell.vm.alive, false);
});

test('disposing the run mid-segment fails the segment without rejecting', async (t) => {
  const { store, runId } = cellFixture(t);
  const tools = [
    tool(
      'slow',
      () => new Promise<string>((r) => setTimeout(() => r('late'), 150)),
    ),
  ];
  const first = await startCodemodeCell({
    code: `await yield_control(); return await tools.slow({});`,
    tools,
    limits,
    store,
    runId,
  });
  const cellId = runningCellId(first);

  const inFlight = resumeCodemodeCell({ store, runId, cellId });
  store.disposeRun(runId);
  const segment = await inFlight;

  assert.equal(segment.ok, false);
  if (!segment.ok) {
    assert.ok(
      segment.error.kind === 'ExecutionFailure' ||
        segment.error.kind === 'TimeoutExceeded',
      `unexpected kind ${segment.error.kind}`,
    );
  }
  assert.equal(store.get(runId, cellId), undefined);
});

test('resuming an unknown cell is CellNotFound', async (t) => {
  const { store, runId } = cellFixture(t);
  const segment = await resumeCodemodeCell({
    store,
    runId,
    cellId: 'nope',
  });
  assert.equal(segment.ok, false);
  if (!segment.ok) assert.equal(segment.error.kind, 'CellNotFound');
  assert.deepEqual(segment.toolCalls, []);
});

test('a fifth concurrent cell is CellLimitExceeded', async (t) => {
  const { store, runId } = cellFixture(t, { maxCells: 4 });
  const start = () =>
    startCodemodeCell({
      code: `await yield_control(); return 1;`,
      tools: [],
      limits,
      store,
      runId,
    });

  for (let i = 0; i < 4; i += 1) {
    runningCellId(await start());
  }

  const fifth = await start();
  assert.equal(fifth.ok, false);
  if (!fifth.ok) assert.equal(fifth.error.kind, 'CellLimitExceeded');
});

test('disposeRun frees every live cell in the run', async (t) => {
  const { store, runId } = cellFixture(t);
  const first = runningCellId(
    await startCodemodeCell({
      code: `await yield_control(); return 1;`,
      tools: [],
      limits,
      store,
      runId,
    }),
  );
  const second = runningCellId(
    await startCodemodeCell({
      code: `await yield_control(); return 2;`,
      tools: [],
      limits,
      store,
      runId,
    }),
  );

  const isolates = [first, second].map((id) => store.get(runId, id)?.vm);
  assert.ok(isolates.every((vm) => vm?.alive));

  store.disposeRun(runId);

  assert.ok(
    isolates.every((vm) => vm?.alive === false),
    'no QuickJS context should outlive the run',
  );
  assert.equal(store.get(runId, first), undefined);
  assert.equal(store.get(runId, second), undefined);
  const resumed = await resumeCodemodeCell({ store, runId, cellId: first });
  assert.equal(resumed.ok, false);
  if (!resumed.ok) assert.equal(resumed.error.kind, 'CellNotFound');
});

test('notify output appears in notifications on the yield payload', async (t) => {
  const { store, runId } = cellFixture(t);
  const segment = await startCodemodeCell({
    code: `
      notify('x');
      notify('n=' + 2);
      await yield_control();
      return 1;
    `,
    tools: [],
    limits,
    store,
    runId,
  });
  runningCellId(segment);
  assert.deepEqual(segment.notifications, ['x', 'n=2']);
});

test('maxToolCalls counts across segments', async (t) => {
  const { store, runId } = cellFixture(t);
  const tools = [tool('n', async () => 'x')];
  const first = await startCodemodeCell({
    code: `
      await tools.n({});
      await yield_control();
      await tools.n({});
      await tools.n({});
      return 1;
    `,
    tools,
    limits: { ...limits, maxToolCalls: 2 },
    store,
    runId,
  });
  const cellId = runningCellId(first);
  assert.deepEqual(first.toolCalls, ['n']);

  const second = await resumeCodemodeCell({ store, runId, cellId });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error.kind, 'ToolCallLimitExceeded');
  assert.deepEqual(second.toolCalls, ['n', 'n']);
});

test('exit completes the cell with a null value', async (t) => {
  const { store, runId } = cellFixture(t);
  const segment = await startCodemodeCell({
    code: `await exit(); return 'unreachable';`,
    tools: [],
    limits,
    store,
    runId,
  });
  assert.equal(segment.ok, true);
  if (segment.ok) {
    assert.equal(segment.running, false);
    if (!segment.running) assert.equal(segment.value, null);
  }
});

test('runCodemode drives yields to completion as a one-shot', async () => {
  const result = await runCodemode({
    code: `
      notify('note');
      await yield_control();
      return 7;
    `,
    tools: [],
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, 7);
    assert.deepEqual(result.notifications, ['note']);
  }
});
