import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runConversationTurn } from './conversation-turn.js';
import type { WorkerExecutor } from './executor.js';
import { executorStateDir } from './executor-files.js';

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

test('a resume throw retries once with the transcript and then stops', async () => {
  const calls: Array<{ context: string; sessionId?: string }> = [];
  const executor: WorkerExecutor = {
    name: 'claude-code',
    resumesSession: true,
    execute: async ({ context, sessionId }) => {
      calls.push({ context, sessionId });
      if (calls.length === 1) throw new Error('resume failed');
      if (calls.length > 2) throw new Error('third call');
      return { text: 'recovered', sessionId: 'sess-2' };
    },
  };
  const result = await runConversationTurn({
    workstream: { id: 'ws-1', goal: 'g', agentSessionId: 'sess-1' },
    repoPath: '/repo',
    content: 'hello',
    prior: [{ direction: 'inbound', content: 'earlier' }],
    executor,
    runBuiltin: async () => 'nope',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sessionId, 'sess-1');
  assert.equal(calls[0].context, 'hello');
  assert.equal(calls[1].sessionId, undefined);
  assert.ok(calls[1].context.includes('[User]: earlier'));
  assert.equal(result.text, 'recovered');
  assert.equal(result.sessionId, 'sess-2');
  assert.equal(result.clearedSession, true);
});

test('artifacts are ingested after a failed resume and its retry', async () => {
  const repoPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-conversation-artifacts-'),
  );
  const published: string[] = [];
  let attempts = 0;
  const executor: WorkerExecutor = {
    name: 'claude-code',
    resumesSession: true,
    execute: async ({ workspaceDir }) => {
      attempts += 1;
      await fs.writeFile(
        path.join(executorStateDir(workspaceDir), '.artificer-artifacts.jsonl'),
        JSON.stringify({
          key: `attempt-${attempts}`,
          name: `Attempt ${attempts}`,
          content: 'content',
        }),
      );
      if (attempts === 1) throw new Error('resume failed');
      return { text: 'recovered' };
    },
  };

  try {
    const result = await runConversationTurn({
      workstream: { id: 'ws-1', goal: 'g', agentSessionId: 'sess-1' },
      repoPath,
      content: 'hello',
      prior: [],
      executor,
      publishArtifact: async (input) => {
        published.push(input.key);
      },
      runBuiltin: async () => 'nope',
    });

    assert.equal(result.text, 'recovered');
    assert.deepEqual(published, ['attempt-1', 'attempt-2']);
    await assert.rejects(
      fs.access(
        path.join(executorStateDir(repoPath), '.artificer-artifacts.jsonl'),
      ),
    );
  } finally {
    await fs.rm(repoPath, { recursive: true, force: true });
  }
});
