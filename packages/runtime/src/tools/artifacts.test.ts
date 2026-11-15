import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { ToolContext } from '../context.js';
import type { RunRecord } from '../storage/types.js';
import { createArtifactTools } from './artifacts.js';

// report_status records nothing in storage; the engine reads the call
// directly from run.toolCalls. The handler only needs to confirm receipt.
function ctxFor(run: RunRecord): ToolContext {
  return {
    engine: {} as unknown as ToolContext['engine'],
    run,
    workspaceDir: '/tmp',
  };
}

function workerRun(): RunRecord {
  return {
    id: 'run_1',
    role: 'worker',
    task: 't',
    status: 'running',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 1,
    },
    createdAt: '1',
  };
}

test('report_status confirms the recorded status and summary', async () => {
  const tools = createArtifactTools(ctxFor(workerRun()));
  const reportStatus = tools.find((t) => t.name === 'report_status');
  assert.ok(reportStatus, 'report_status tool is present');

  const out = await reportStatus.handler({
    status: 'done',
    summary: 'Fixed the off-by-one in foo.ts',
  });
  assert.match(out, /done/i);
  assert.match(out, /Fixed the off-by-one in foo\.ts/);
});

test('report_status accepts an optional followUps note', async () => {
  const tools = createArtifactTools(ctxFor(workerRun()));
  const reportStatus = tools.find((t) => t.name === 'report_status');

  const out = await reportStatus!.handler({
    status: 'done_with_concerns',
    summary: 'Implemented the fix.',
    followUps: 'Add a regression test.',
  });
  assert.match(out, /done_with_concerns/i);
});
