import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defineTool } from '../api/define-tool.js';
import { ToolRegistry } from '../api/tool-registry.js';
import type { ToolContext } from '../context.js';
import { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';
import { toolsForRole } from './registry.js';

async function freshCtx(role: RunRecord['role']): Promise<ToolContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-registry-'));
  const store = new Store(dir);
  await store.init();
  const run = await store.createRun({ role, task: 't' });
  return {
    // toolsForRole eagerly constructs createShellTool/createGitTools for
    // every role, and those read ctx.engine.config.github at call time —
    // so `config` must be present (even if empty) or construction throws.
    engine: { store, config: {} } as unknown as ToolContext['engine'],
    run,
    workspaceDir: '/tmp',
  };
}

for (const role of ['communicator', 'planner', 'librarian']) {
  test(`toolsForRole('${role}') includes search_history`, async () => {
    const ctx = await freshCtx(role);
    const tools = toolsForRole(role, ctx);
    assert.ok(
      tools.some((t) => t.name === 'search_history'),
      `${role} should have search_history`,
    );
  });
}

for (const role of ['worker', 'reviewer']) {
  test(`toolsForRole('${role}') does not include search_history`, async () => {
    const ctx = await freshCtx(role);
    const tools = toolsForRole(role, ctx);
    assert.ok(
      !tools.some((t) => t.name === 'search_history'),
      `${role} should not have search_history`,
    );
  });
}

for (const role of ['worker', 'orchestrator'] as const) {
  test(`toolsForRole('${role}') includes execute`, async () => {
    const ctx = await freshCtx(role);
    const tools = toolsForRole(role, ctx);
    assert.ok(
      tools.some((t) => t.name === 'execute'),
      `${role} should have execute`,
    );
  });
}

for (const role of [
  'planner',
  'reviewer',
  'communicator',
  'librarian',
  'receipt',
] as const) {
  test(`toolsForRole('${role}') does not include execute`, async () => {
    const ctx = await freshCtx(role);
    const tools = toolsForRole(role, ctx);
    assert.ok(
      !tools.some((t) => t.name === 'execute'),
      `${role} should not have execute`,
    );
  });
}

test('execute siblings include custom tools and exclude execute', async () => {
  const ctx = await freshCtx('worker');
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: 'custom_ping',
      description: 'ping',
      input: { type: 'object', properties: {}, required: [] },
      roles: ['worker'],
      execute: async () => 'pong',
    }),
  );
  const tools = toolsForRole('worker', ctx, registry);
  const execute = tools.find((t) => t.name === 'execute');
  assert.ok(execute);
  assert.match(execute.description, /tools\.custom_ping/);
  assert.doesNotMatch(execute.description, /tools\.execute/);
  const names = tools.filter((t) => t.name === 'execute');
  assert.equal(names.length, 1);
});

test('execute cannot call itself from a guest program', async () => {
  const ctx = await freshCtx('worker');
  const tools = toolsForRole('worker', ctx);
  const execute = tools.find((t) => t.name === 'execute');
  assert.ok(execute);

  const raw = await execute.handler({
    code: `return await tools.execute({ code: 'return 1;' });`,
  });
  const result = JSON.parse(raw) as {
    ok: boolean;
    error?: { kind: string; message: string };
  };

  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, 'ExecutionFailure');
  assert.match(result.error?.message ?? '', /execute/);
});

test('custom tool named execute is skipped with a warning', async () => {
  const ctx = await freshCtx('worker');
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: 'execute',
      description: 'should not ship',
      input: { type: 'object', properties: {}, required: [] },
      roles: ['worker'],
      execute: async () => 'nope',
    }),
  );
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const tools = toolsForRole('worker', ctx, registry);
    const execute = tools.find((t) => t.name === 'execute');
    assert.ok(execute);
    assert.match(execute.description, /tools\./);
    assert.doesNotMatch(execute.description, /should not ship/);
  } finally {
    console.warn = originalWarn;
  }
  assert.match(String(warnings[0]?.[0]), /reserved/);
});
