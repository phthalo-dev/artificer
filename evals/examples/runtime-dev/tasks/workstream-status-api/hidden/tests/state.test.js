import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getState } from '../src/state.js';

test('getState includes paused derived from workstreams', () => {
  assert.equal(getState([]).paused, false);
  assert.equal(getState([{ id: 'a', status: 'running' }]).paused, false);
  assert.equal(
    getState([
      { id: 'a', status: 'running' },
      { id: 'b', status: 'paused' },
    ]).paused,
    true,
  );
  assert.equal(getState([]).status, 'ok');
});
