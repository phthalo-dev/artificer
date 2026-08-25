import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defineTool } from '../api/define-tool.js';
import { ToolRegistry } from '../api/tool-registry.js';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { Store } from '../storage/store.js';
import { createToolPlan } from './tool-plan.js';

async function fakeCtx(): Promise<ToolContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-tool-plan-'));
  const store = new Store(dir);
  await store.init();
  const run = await store.createRun({ role: 'worker', task: 't' });
  return {
    engine: {
      store,
      config: {
        codemode: {
          timeoutMs: 120_000,
          maxToolCalls: 32,
          maxOutputBytes: 12_000,
        },
      },
    } as unknown as ToolContext['engine'],
    run,
    workspaceDir: '/tmp',
  };
}

test('createToolPlan freezes alwaysOn and lists names', async () => {
  const plan = createToolPlan({ role: 'worker', ctx: await fakeCtx() });
  assert.ok(plan.alwaysOn.length > 0);
  assert.deepEqual(
    plan.alwaysOnNames,
    plan.alwaysOn.map((t) => t.name),
  );
  assert.throws(() => {
    (plan.alwaysOn as ToolDef[]).push({
      name: 'x',
      description: '',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => '',
    });
  });
  assert.equal(plan.deferred.size, 0);
});

test('createToolPlan includes custom registry tools for worker', async () => {
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: 'echo_custom',
      description: 'echo',
      input: { type: 'object', properties: {} },
      roles: ['worker'],
      execute: async () => 'ok',
    }),
  );
  const plan = createToolPlan({
    role: 'worker',
    ctx: await fakeCtx(),
    customRegistry: registry,
  });
  assert.ok(plan.alwaysOnNames.includes('echo_custom'));
});
