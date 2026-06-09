import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withWallClockTimeout } from './call-timeout.js';

test('withWallClockTimeout resolves when promise finishes in time', async () => {
  const value = await withWallClockTimeout(
    Promise.resolve(42),
    1000,
    'test',
  );
  assert.equal(value, 42);
});

test('withWallClockTimeout rejects when promise exceeds limit', async () => {
  await assert.rejects(
    withWallClockTimeout(
      new Promise<number>((resolve) => setTimeout(() => resolve(1), 200)),
      50,
      'planner call',
    ),
    /planner call exceeded wall-clock limit/,
  );
});
