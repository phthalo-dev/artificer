import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'vitest';
import { runShellCommand } from './shell.js';

test('runShellCommand returns stdout for a normal command', async () => {
  const res = await runShellCommand({
    command: 'echo hello',
    cwd: os.tmpdir(),
    env: process.env,
    timeoutMs: 5000,
  });
  assert.equal(res.timedOut, false);
  assert.match(res.output, /hello/);
});

test('runShellCommand kills a process that ignores SIGTERM (SIGKILL on timeout)', async () => {
  const start = Date.now();
  const res = await runShellCommand({
    // Ignore SIGTERM, then sleep far longer than the timeout. Only SIGKILL
    // (which cannot be trapped) can stop this promptly.
    command: "trap '' TERM; sleep 30",
    cwd: os.tmpdir(),
    env: process.env,
    timeoutMs: 1000,
  });
  const elapsed = Date.now() - start;
  assert.equal(res.timedOut, true);
  assert.ok(elapsed < 8000, `expected prompt SIGKILL, took ${elapsed}ms`);
  assert.match(res.output, /timed out/i);
});
