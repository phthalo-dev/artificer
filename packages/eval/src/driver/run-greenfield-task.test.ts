import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import type { LoadedEvalTask } from '../types.js';
import type { RuntimeClient, RuntimeState } from './client.js';
import { runGreenfieldTask } from './run-greenfield-task.js';

const execFileAsync = promisify(execFile);
const fixtureRoot = fileURLToPath(
  new URL('../identity/fixtures/greenfield-hello-tool/', import.meta.url),
);

test('runs a greenfield workstream and grades its extracted patch', async () => {
  const execDir = await fs.mkdtemp(path.join(os.tmpdir(), 'greenfield-run-'));
  let createInput: Parameters<RuntimeClient['createWorkstream']>[0] | undefined;
  let stateCalls = 0;

  const client = {
    createWorkstream: async (
      input: Parameters<RuntimeClient['createWorkstream']>[0],
    ) => {
      createInput = input;
      const workspace = path.join(execDir, 'workspace', 'ws-greenfield');
      await fs.mkdir(workspace, { recursive: true });
      await execFileAsync('git', ['clone', '-q', input.repoUrl!, 'repo'], {
        cwd: workspace,
      });
      await fs.writeFile(
        path.join(workspace, 'repo', 'src', 'hello.js'),
        [
          'export function hello(name) {',
          '  return `Hello, ${name}!`;',
          '}',
          '',
        ].join('\n'),
      );
      return { workstreamId: 'ws-greenfield', messageId: 'msg-greenfield' };
    },
    getState: async (): Promise<RuntimeState> => {
      stateCalls += 1;
      return runtimeState(stateCalls === 1 ? 'in_progress' : 'done');
    },
    messageCost: async () => ({
      message: {
        id: 'msg-greenfield',
        direction: 'inbound' as const,
        content: 'Implement hello',
        createdAt: '2026-08-11T00:00:00.000Z',
      },
      total: {
        inputTokens: 20,
        outputTokens: 8,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        requests: 2,
        runs: 2,
        costUsd: 0.03,
      },
      byWorkstream: {},
      byRole: {},
    }),
  } as RuntimeClient;

  try {
    const result = await runGreenfieldTask(client, greenfieldTask(), {
      execDir,
      pollIntervalMs: 0,
      timeoutMs: 100,
    });

    assert.equal(createInput?.goal, 'Implement a hello(name) function.\n');
    assert.equal(createInput?.autostart, true);
    assert.equal(typeof createInput?.repoUrl, 'string');
    assert.equal(typeof createInput?.baseCommit, 'string');
    assert.equal(result.outcome, 'submitted');
    assert.equal(result.resolved, true);
    assert.equal(result.messageId, 'msg-greenfield');
    assert.equal(result.usage?.costUsd, 0.03);
  } finally {
    await fs.rm(execDir, { recursive: true, force: true });
  }
});

function greenfieldTask(): LoadedEvalTask {
  return {
    manifest: {
      id: 'greenfield-hello-tool',
      title: 'Implement hello',
      kind: 'greenfield',
      test_command: 'node --test tests/*.test.js',
      grade: {
        type: 'shell',
        command: 'node --test tests/*.test.js',
      },
    },
    prompt: 'Implement a hello(name) function.\n',
    taskDir: fixtureRoot,
    fixtureDir: path.join(fixtureRoot, 'fixture'),
    hiddenDir: path.join(fixtureRoot, 'hidden'),
  };
}

function runtimeState(status: 'in_progress' | 'done'): RuntimeState {
  const busy = status === 'in_progress';
  return {
    agentName: 'test',
    busy,
    queue: busy ? { pending: 0, running: 1 } : { pending: 0, running: 0 },
    workstreams: [{ id: 'ws-greenfield', title: 'Implement hello', status }],
  };
}
