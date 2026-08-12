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
import { runRepoPatchTask } from './run-repo-patch-task.js';

const execFileAsync = promisify(execFile);
const fixtureRoot = fileURLToPath(
  new URL('../identity/fixtures/fix-format-cost-display/', import.meta.url),
);

test('runs a repo-patch workstream and grades its extracted fix', async () => {
  const execDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-patch-run-'));
  let createInput: Parameters<RuntimeClient['createWorkstream']>[0] | undefined;
  let stateCalls = 0;

  const client = {
    createWorkstream: async (
      input: Parameters<RuntimeClient['createWorkstream']>[0],
    ) => {
      createInput = input;
      const workspace = path.join(execDir, 'workspace', 'ws-repo-patch');
      await fs.mkdir(workspace, { recursive: true });
      await execFileAsync('git', ['clone', '-q', input.repoUrl!, 'repo'], {
        cwd: workspace,
      });
      // Agent restores the correct four-decimal branch for sub-cent amounts.
      await fs.writeFile(
        path.join(workspace, 'repo', 'src', 'format.js'),
        [
          'export function formatCost(usd) {',
          "  if (!usd) return '$0.00';",
          '  if (usd < 0.01) return `$${usd.toFixed(4)}`;',
          '  return `$${usd.toFixed(2)}`;',
          '}',
          '',
        ].join('\n'),
      );
      return { workstreamId: 'ws-repo-patch', messageId: 'msg-repo-patch' };
    },
    getState: async (): Promise<RuntimeState> => {
      stateCalls += 1;
      return runtimeState(stateCalls === 1 ? 'in_progress' : 'done');
    },
    messageCost: async () => ({
      message: {
        id: 'msg-repo-patch',
        direction: 'inbound' as const,
        content: 'Fix formatCost',
        createdAt: '2026-08-11T00:00:00.000Z',
      },
      total: {
        inputTokens: 20,
        outputTokens: 8,
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

  try {
    const result = await runRepoPatchTask(client, repoPatchTask(), {
      execDir,
      pollIntervalMs: 0,
      timeoutMs: 100,
    });

    assert.match(createInput?.goal ?? '', /formatCost/);
    assert.equal(createInput?.autostart, true);
    assert.equal(typeof createInput?.repoUrl, 'string');
    assert.equal(typeof createInput?.baseCommit, 'string');
    assert.equal(result.outcome, 'submitted');
    assert.equal(result.resolved, true);
    assert.equal(result.messageId, 'msg-repo-patch');
    assert.equal(result.usage?.costUsd, 0.02);
  } finally {
    await fs.rm(execDir, { recursive: true, force: true });
  }
});

function repoPatchTask(): LoadedEvalTask {
  return {
    manifest: {
      id: 'fix-format-cost-display',
      title: 'Fix cost formatting regression',
      kind: 'repo-patch',
      repo: { url: 'fixture', baseCommit: 'local' },
      grade: {
        type: 'shell',
        command: 'node --test tests/*.test.js',
      },
    },
    prompt:
      '`formatCost()` in `src/format.js` has a regression: amounts below one cent\ndisplay as `$0.00` instead of four decimal places. Restore the previous\nbehavior so `formatCost(0.0042)` returns `$0.0042`, while keeping `$0.00`\nfor zero and two decimals for amounts ≥ $0.01.\n',
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
    workstreams: [
      { id: 'ws-repo-patch', title: 'Fix cost formatting regression', status },
    ],
  };
}
