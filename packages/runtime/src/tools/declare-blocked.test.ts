import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolContext } from '../context.js';
import type { RunRecord } from '../storage/types.js';
import { createDeclareBlockedTool } from './declare-blocked.js';

function stubCtx(): ToolContext {
  const run: RunRecord = {
    id: 'run-1',
    role: 'worker',
    task: 'test',
    status: 'running',
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, requests: 0 },
    createdAt: new Date().toISOString(),
  };
  return {
    engine: { config: {} } as ToolContext['engine'],
    run,
    workspaceDir: '/tmp',
  };
}

test('declare_blocked returns BLOCKED prefix', async () => {
  const tool = createDeclareBlockedTool(stubCtx());
  const out = await tool.handler({
    reason: 'tests require missing dependency',
    attemptsSummary: 'tried pip install, env broken',
  });
  assert.match(out, /^BLOCKED: tests require missing dependency/);
  assert.match(out, /Attempts: tried pip install/);
});

test('declare_blocked rejects empty reason', async () => {
  const tool = createDeclareBlockedTool(stubCtx());
  await assert.rejects(
    () => tool.handler({ reason: '  ', attemptsSummary: 'tried stuff' }),
    /reason is required/,
  );
});
