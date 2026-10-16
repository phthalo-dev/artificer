import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runConversationTurn } from './conversation-turn.js';

test('the runner posts executor text and ignores workerStatus', async () => {
  const calls: string[] = [];
  const result = await runConversationTurn({
    workstream: { id: 'ws-1', goal: 'g' },
    repoPath: '/repo',
    content: 'hello',
    prior: [],
    executor: {
      name: 'fake',
      resumesSession: false,
      execute: async ({ context }) => {
        calls.push(context);
        return { text: 'hi', workerStatus: 'done' };
      },
    },
    runBuiltin: async () => 'nope',
  });
  assert.equal(result.text, 'hi');
  assert.equal(result.sessionId, undefined);
  assert.ok(calls[0].includes('Workstream goal: g'));
  assert.ok(calls[0].endsWith('[User]: hello'));
});

test('an empty executor body becomes (no output)', async () => {
  const result = await runConversationTurn({
    workstream: { id: 'ws-1', goal: 'g' },
    repoPath: '/repo',
    content: 'hello',
    prior: [],
    executor: {
      name: 'fake',
      execute: async () => ({ text: '   ' }),
    },
    runBuiltin: async () => '',
  });
  assert.equal(result.text, '(no output)');
});
