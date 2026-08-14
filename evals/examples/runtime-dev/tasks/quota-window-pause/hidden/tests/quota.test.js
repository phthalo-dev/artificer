import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldPauseWindow } from '../src/quota.js';

test('shouldPauseWindow pauses at and above the limit', () => {
  assert.equal(shouldPauseWindow(0, 100), false);
  assert.equal(shouldPauseWindow(99, 100), false);
  assert.equal(shouldPauseWindow(100, 100), true);
  assert.equal(shouldPauseWindow(150, 100), true);
  assert.equal(shouldPauseWindow(50, 0), false);
});
