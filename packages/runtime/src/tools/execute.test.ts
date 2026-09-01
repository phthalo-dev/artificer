import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { CodemodeCellStore } from '../codemode/cells.js';
import { DEFAULT_CODEMODE_LIMITS } from '../config.js';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { createExecuteTool } from './execute.js';

function ctx(): ToolContext {
  return {
    engine: {
      config: { codemode: DEFAULT_CODEMODE_LIMITS },
    } as ToolContext['engine'],
    run: { id: 'run_1' } as ToolContext['run'],
    workspaceDir: '/tmp',
  };
}

test('execute runs sibling tools and returns JSON', async () => {
  const siblings: ToolDef[] = [
    {
      name: 'echo',
      description: 'Echo v',
      inputSchema: {
        type: 'object',
        properties: { v: { type: 'string', description: 'value' } },
        required: ['v'],
      },
      handler: async (input) => String(input.v),
    },
  ];
  const tool = createExecuteTool(ctx(), siblings, DEFAULT_CODEMODE_LIMITS);
  assert.equal(tool.name, 'execute');
  assert.match(tool.description, /tools\.echo/);
  assert.match(tool.description, /Echo v/);
  assert.match(tool.description, /yield_control\(\)/);
  assert.match(tool.description, /store\(key, value\)/);
  assert.match(tool.description, /load\(key\)/);
  assert.match(tool.description, /notify\(/);
  assert.match(tool.description, /exit\(\)/);
  assert.match(tool.description, /@exec: \{"yield_time_ms": N\}/);
  assert.match(tool.description, /running: true, cellId/);
  assert.match(tool.description, /wait_execute/);
  const raw = await tool.handler({
    code: 'return await tools.echo({ v: "z" });',
  });
  const parsed = JSON.parse(raw) as { ok: boolean; value: unknown };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value, 'z');
});

test('execute falls back to runCodemode when ctx.codemodeCells is missing', async () => {
  const tool = createExecuteTool(ctx(), [], DEFAULT_CODEMODE_LIMITS);
  const raw = await tool.handler({
    code: `await yield_control(); return 'done';`,
  });
  const parsed = JSON.parse(raw) as { ok: boolean; value?: unknown };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value, 'done');
});

test('execute starts a cell when ctx.codemodeCells is set', async (t: TestContext) => {
  const store = new CodemodeCellStore({ maxCells: 4, cellTtlMs: 120_000 });
  t.after(() => store.disposeRun('run_1'));
  const tool = createExecuteTool(
    { ...ctx(), codemodeCells: store },
    [],
    DEFAULT_CODEMODE_LIMITS,
  );
  const raw = await tool.handler({
    code: `await yield_control(); return 'done';`,
  });
  const parsed = JSON.parse(raw) as {
    ok: boolean;
    running?: boolean;
    cellId?: string;
  };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.running, true);
  assert.equal(typeof parsed.cellId, 'string');
  assert.ok(store.get('run_1', parsed.cellId!));
});
