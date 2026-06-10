import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';
import { killProcessGroup, runShellCommandSpawn } from './shell-spawn.js';

test('runShellCommandSpawn is exported', () => {
  assert.equal(typeof runShellCommandSpawn, 'function');
});

test('runShellCommandSpawn returns stdout for a fast echo command', async () => {
  const res = await runShellCommandSpawn({
    command: 'echo spawn-hello',
    cwd: os.tmpdir(),
    env: process.env,
    timeoutMs: 5000,
  });
  assert.equal(res.timedOut, false);
  assert.match(res.output, /spawn-hello/);
});

test('runShellCommandSpawn marks timed-out commands', async () => {
  if (process.platform === 'win32') {
    return;
  }
  const start = Date.now();
  const res = await runShellCommandSpawn({
    command: "trap '' TERM; sleep 30",
    cwd: os.tmpdir(),
    env: process.env,
    timeoutMs: 500,
  });
  const elapsed = Date.now() - start;
  assert.equal(res.timedOut, true);
  assert.ok(elapsed < 8000, `expected prompt kill, took ${elapsed}ms`);
  assert.match(res.output, /timed out/i);
});

test('killProcessGroup targets the negative pid on Unix', () => {
  if (process.platform === 'win32') {
    return;
  }
  const originalKill = process.kill.bind(process);
  const calls: Array<[number, NodeJS.Signals | undefined]> = [];
  process.kill = ((pid: number, signal?: NodeJS.Signals) => {
    calls.push([pid, signal]);
    if (pid < 0) {
      throw new Error('ESRCH');
    }
    throw new Error('ESRCH');
  }) as typeof process.kill;

  try {
    killProcessGroup(4242);
    assert.deepEqual(calls, [[-4242, 'SIGKILL'], [4242, 'SIGKILL']]);
  } finally {
    process.kill = originalKill;
  }
});
