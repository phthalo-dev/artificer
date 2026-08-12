import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RuntimeClient, RuntimeState } from './client.js';
import { runWorkstreamTask } from './run-workstream-task.js';
import type { LoadedEvalTask } from '../types.js';

test('creates, polls, and grades a workstream task', async () => {
  let createInput: Parameters<RuntimeClient['createWorkstream']>[0] | undefined;
  let stateCalls = 0;
  const client = {
    createWorkstream: async (
      input: Parameters<RuntimeClient['createWorkstream']>[0],
    ) => {
      createInput = input;
      return { workstreamId: 'ws-1', messageId: 'msg-1' };
    },
    getState: async (): Promise<RuntimeState> => {
      stateCalls += 1;
      return runtimeState(stateCalls === 1 ? 'in_progress' : 'done');
    },
    messageCost: async () => ({
      message: {
        id: 'msg-1',
        direction: 'inbound' as const,
        content: 'Reply with a summary',
        createdAt: '2026-08-11T00:00:00.000Z',
      },
      total: {
        inputTokens: 12,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        requests: 2,
        runs: 2,
        costUsd: 0.02,
      },
      byWorkstream: {},
      byRole: {},
    }),
  } as RuntimeClient;

  const result = await runWorkstreamTask(client, workstreamTask(), {
    pollIntervalMs: 0,
    timeoutMs: 100,
  });

  assert.deepEqual(createInput, {
    title: 'Workstream smoke',
    goal: 'Reply with a summary',
    autostart: true,
  });
  assert.equal(stateCalls, 2);
  assert.equal(result.instanceId, 'workstream-smoke');
  assert.equal(result.outcome, 'submitted');
  assert.equal(result.messageId, 'msg-1');
  assert.deepEqual(result.outboundMessages, []);
  assert.equal(result.resolved, true);
  assert.equal(result.usage?.costUsd, 0.02);
});

function workstreamTask(): LoadedEvalTask {
  return {
    manifest: {
      id: 'workstream-smoke',
      title: 'Workstream smoke',
      kind: 'workstream',
      grade: { type: 'workstream-status', expect: ['done'] },
    },
    prompt: 'Reply with a summary',
    taskDir: '/tmp/workstream-smoke',
  };
}

function runtimeState(status: 'in_progress' | 'done'): RuntimeState {
  const busy = status === 'in_progress';
  return {
    agentName: 'test',
    busy,
    queue: busy ? { pending: 0, running: 1 } : { pending: 0, running: 0 },
    workstreams: [{ id: 'ws-1', title: 'Workstream smoke', status }],
  };
}
