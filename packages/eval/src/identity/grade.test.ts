import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RuntimeClient, RuntimeState } from '../driver/client.js';
import { runMessageTask } from '../driver/run-message-task.js';
import type { LoadedEvalTask } from '../types.js';
import { gradeMessageContains, gradeWorkstreamStatus } from './grade.js';

test('message-contains passes when pattern matches an outbound message', () => {
  assert.equal(
    gradeMessageContains(
      ['No matching content here', 'Your preset is async-economy'],
      'async-economy',
    ),
    true,
  );
});

test('message-contains fails when no outbound message matches', () => {
  assert.equal(
    gradeMessageContains(['Your preset is quality-first'], 'async-economy'),
    false,
  );
});

test('workstream-status passes only for an expected terminal status', () => {
  assert.equal(gradeWorkstreamStatus('done', ['done']), true);
  assert.equal(gradeWorkstreamStatus('failed', ['done']), false);
  assert.equal(gradeWorkstreamStatus('blocked', ['done', 'blocked']), true);
});

test('runMessageTask submits, captures outbound messages, and records usage', async () => {
  const originalFetch = globalThis.fetch;
  const frames = [
    'event: message',
    `data: ${JSON.stringify({
      kind: 'message',
      at: '2026-08-11T00:00:00.000Z',
      data: {
        id: 'out-1',
        direction: 'outbound',
        content: 'The configured preset is async-economy.',
        createdAt: '2026-08-11T00:00:00.000Z',
      },
    })}`,
    '',
    '',
  ].join('\n');
  globalThis.fetch = (async (url) => {
    assert.equal(url, 'http://runtime.test/events');
    return new Response(frames, {
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;

  let sentPrompt: string | undefined;
  let stateCalls = 0;
  const client = {
    baseUrl: 'http://runtime.test',
    sendMessage: async (content: string) => {
      sentPrompt = content;
      return {
        id: 'in-1',
        direction: 'inbound' as const,
        content,
        createdAt: '2026-08-11T00:00:00.000Z',
      };
    },
    getState: async (): Promise<RuntimeState> => {
      stateCalls += 1;
      return runtimeState(stateCalls === 1);
    },
    messageCost: async () => ({
      message: {
        id: 'in-1',
        direction: 'inbound' as const,
        content: 'Which preset?',
        createdAt: '2026-08-11T00:00:00.000Z',
      },
      total: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        requests: 1,
        runs: 1,
        costUsd: 0.01,
      },
      byWorkstream: {},
      byRole: {},
    }),
  } as RuntimeClient;

  try {
    const result = await runMessageTask(client, messageTask(), {
      pollIntervalMs: 0,
      timeoutMs: 100,
    });

    assert.equal(sentPrompt, 'Which preset?');
    assert.equal(result.instanceId, 'preset-query');
    assert.equal(result.outcome, 'submitted');
    assert.equal(result.messageId, 'in-1');
    assert.deepEqual(result.outboundMessages, [
      'The configured preset is async-economy.',
    ]);
    assert.equal(result.resolved, true);
    assert.equal(result.usage?.costUsd, 0.01);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function messageTask(): LoadedEvalTask {
  return {
    manifest: {
      id: 'preset-query',
      title: 'Preset query',
      kind: 'message',
      grade: { type: 'message-contains', pattern: 'async-economy' },
    },
    prompt: 'Which preset?',
    taskDir: '/tmp/preset-query',
  };
}

function runtimeState(busy: boolean): RuntimeState {
  return {
    agentName: 'test',
    busy,
    queue: busy ? { pending: 0, running: 1 } : { pending: 0, running: 0 },
    workstreams: [],
  };
}
