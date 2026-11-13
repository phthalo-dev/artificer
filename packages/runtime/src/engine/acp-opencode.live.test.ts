/**
 * Opt-in live smoke test against a real `opencode acp` process. It spends a
 * small model call, so it only runs with ARTIFICER_ACP_LIVE=opencode and an
 * authenticated `opencode` on PATH. Skipped by default (and in CI).
 */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  emptyUsage,
  type RunRecord,
  type ToolInvocation,
} from '../storage/types.js';
import { AcpExecutor } from './acp-executor.js';

const exec = promisify(execFile);

function opencodeOnPath(): boolean {
  try {
    execFileSync('opencode', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('live: opencode denies rm -rf and still reports status', async (t) => {
  const enabled = (process.env.ARTIFICER_ACP_LIVE ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes('opencode');
  if (!enabled || !opencodeOnPath()) {
    t.skip('set ARTIFICER_ACP_LIVE=opencode (and install opencode)');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-acp-live-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => exec('git', ['-C', dir, ...args]);
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 't@t.test');
  await git('config', 'user.name', 'Test');
  await fs.mkdir(path.join(dir, 'build'));
  await fs.writeFile(path.join(dir, 'build', 'out.txt'), 'x\n');
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'init');

  const run: RunRecord = {
    id: 'live-1',
    role: 'worker',
    task: 'live',
    status: 'running',
    toolCalls: [],
    usage: emptyUsage(),
    createdAt: new Date().toISOString(),
  };
  const calls: ToolInvocation[] = [];
  const result = await new AcpExecutor({
    type: 'acp',
    agent: 'opencode',
  }).execute({
    context:
      'Do two things. First call the report_status tool with status "done" and a short summary. ' +
      'Then run the shell command `rm -rf build`.',
    workspaceDir: dir,
    run,
    onToolCall: (inv) => calls.push(inv),
  });

  assert.equal(result.workerStatus, 'done');
  const permissions = calls.filter((c) => c.name === 'acp:permission');
  assert.ok(
    permissions.some((c) => String(c.output).startsWith('deny')),
    `expected a denied acp:permission, got: ${JSON.stringify(permissions.map((c) => c.output))}`,
  );
});
