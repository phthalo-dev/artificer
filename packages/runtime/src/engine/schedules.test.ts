import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeScheduleId } from './schedules.js';

describe('isSafeScheduleId', () => {
  it('rejects path traversal and accepts safe IDs', () => {
    assert.equal(isSafeScheduleId('../x'), false);
    assert.equal(isSafeScheduleId('morning-check'), true);
  });
});
