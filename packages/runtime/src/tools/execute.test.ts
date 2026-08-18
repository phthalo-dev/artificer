import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CODEMODE_LIMITS } from '../config.js';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { createExecuteTool } from './execute.js';

function ctx(): ToolContext {
  return {
    engine: { config: { codemode: DEFAULT_CODEMODE_LIMITS } } as ToolContext['engine'],
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
  const raw = await tool.handler({
    code: 'return await tools.echo({ v: "z" });',
  });
  const parsed = JSON.parse(raw) as { ok: boolean; value: unknown };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value, 'z');
});
