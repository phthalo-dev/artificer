import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executorAccountId } from './quota-config-helpers.js';

test('executorAccountId names acp accounts by command basename', () => {
  assert.equal(
    executorAccountId({
      type: 'acp',
      command: '/usr/local/bin/gemini',
      args: ['--acp'],
    }),
    'acp:gemini',
  );
});
