import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCost } from '../src/format.js';

test('formatCost formats zero and small amounts', () => {
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(0.0042), '$0.0042');
  assert.equal(formatCost(1.5), '$1.50');
});
