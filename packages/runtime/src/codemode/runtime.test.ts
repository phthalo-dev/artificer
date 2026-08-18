import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CODEMODE_LIMITS } from '../config.js';
import { runCodemode, type CodemodeTool } from './runtime.js';

const limits = {
  ...DEFAULT_CODEMODE_LIMITS,
  timeoutMs: 5_000,
};

function tool(name: string, handler: CodemodeTool['handler']): CodemodeTool {
  return { name, handler };
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

test('tight loop hits TimeoutExceeded', async () => {
  const result = await runCodemode({
    code: 'while (true) {}',
    tools: [],
    limits: { ...limits, timeoutMs: 50 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'TimeoutExceeded');
});

test('oversize return is ok with truncated true', async () => {
  const result = await runCodemode({
    code: `return 'x'.repeat(1000);`,
    tools: [],
    limits: { ...limits, maxOutputBytes: 50 },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.truncated, true);
    const encoded = Buffer.byteLength(JSON.stringify(result.value), 'utf8');
    assert.ok(encoded <= 50 || typeof result.value === 'string');
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
