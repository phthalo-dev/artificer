import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolContext } from '../context.js';
import type { RunRecord } from '../storage/types.js';
import { createDeclareDoneTool } from './declare-done.js';

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
    engine: { config: { singleLoop: true } } as ToolContext['engine'],
    run,
    workspaceDir: '/tmp',
  };
}

test('declare_done returns DONE prefix with summary and tests', async () => {
  const tool = createDeclareDoneTool(stubCtx());
  const out = await tool.handler({
    summary: 'fixed the bug in parser.ts',
    verified: true,
    testsRun: 'pytest tests/test_parser.py',
  });
  assert.equal(out, 'DONE: fixed the bug in parser.ts (tests: pytest tests/test_parser.py)');
});

test('declare_done rejects empty summary', async () => {
  const tool = createDeclareDoneTool(stubCtx());
  await assert.rejects(
    () => tool.handler({ summary: '   ', verified: true }),
    /summary is required/,
  );
});

test('declare_done rejects verified=false', async () => {
  const tool = createDeclareDoneTool(stubCtx());
  await assert.rejects(
    () => tool.handler({ summary: 'attempted fix', verified: false }),
    /verified must be true/,
  );
});

test('declare_done rejects missing verified', async () => {
  const tool = createDeclareDoneTool(stubCtx());
  await assert.rejects(
    () => tool.handler({ summary: 'attempted fix' }),
    /verified must be true/,
  );
});
