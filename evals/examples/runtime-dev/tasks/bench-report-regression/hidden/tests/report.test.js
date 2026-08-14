import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRate } from '../src/report.js';

test('resolveRate is resolved over total', () => {
  assert.equal(resolveRate(0, 0), 0);
  assert.equal(resolveRate(1, 0), 0);
  assert.equal(resolveRate(3, 4), 0.75);
  assert.equal(resolveRate(2, 2), 1);
});
