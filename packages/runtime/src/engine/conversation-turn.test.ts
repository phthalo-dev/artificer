import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { AcpExecutor } from './acp-executor.js';
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

test('a missing session retries once with the transcript and then stops', async () => {
  const calls: Array<{ context: string; sessionId?: string }> = [];
  const executor: WorkerExecutor = {
    name: 'claude-code',
    resumesSession: true,
    execute: async ({ context, sessionId }) => {
      calls.push({ context, sessionId });
      if (calls.length === 1) {
        throw new Error(
          'claude code agent exited with code 1: No conversation found with session ID: sess-1',
        );
      }
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

test('a resume timeout does not run the turn again', async () => {
  const calls: string[] = [];
  const executor: WorkerExecutor = {
    name: 'claude-code',
    resumesSession: true,
    execute: async () => {
      calls.push('run');
      throw new Error('claude code agent timed out');
    },
  };
  await assert.rejects(
    runConversationTurn({
      workstream: { id: 'ws-1', goal: 'g', agentSessionId: 'sess-1' },
      repoPath: '/repo',
      content: 'hello',
      prior: [],
      executor,
      runBuiltin: async () => 'nope',
    }),
    /timed out/,
  );
  assert.equal(calls.length, 1);
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
      if (attempts === 1) {
        throw new Error('No conversation found with session ID: sess-1');
      }
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

test('acp executor without resume falls back to transcript', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-acp-turn-'));
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-acp-ws-'));
  t.onTestFinished(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });
  const recordFile = path.join(dir, 'record.jsonl');
  const scenarioPath = path.join(dir, 'scenario.json');
  await fs.writeFile(
    scenarioPath,
    JSON.stringify({
      recordFile,
      steps: [{ type: 'message', text: 'fresh' }],
    }),
  );
  const fake = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '__fixtures__',
    'fake-acp-agent.mjs',
  );
  const executor = new AcpExecutor({
    type: 'acp',
    command: process.execPath,
    args: [fake, scenarioPath],
    resumes: true,
  });
  const result = await runConversationTurn({
    workstream: { id: 'ws-1', goal: 'g', agentSessionId: 'old-session' },
    repoPath: repo,
    content: 'hello',
    prior: [{ direction: 'inbound', content: 'earlier' }],
    executor,
    runBuiltin: async () => 'nope',
  });
  assert.equal(result.text, 'fresh');
  assert.equal(result.clearedSession, true);
  const records = (await fs.readFile(recordFile, 'utf-8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const prompts = records.filter((r) => r.method === 'session/prompt');
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].params.prompt[0].text.includes('[User]: earlier'));
});
