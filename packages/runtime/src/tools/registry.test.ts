import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
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
