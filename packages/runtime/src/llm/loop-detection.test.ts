import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkRepeatedToolCall,
  createLoopDetectionState,
  toolCallSignature,
} from './loop-detection.js';

const config = { softThreshold: 3, hardThreshold: 6 };

test('different calls reset count', () => {
  const state = createLoopDetectionState();
  checkRepeatedToolCall(state, 'read_file', toolCallSignature({ path: 'a.ts' }), config);
  checkRepeatedToolCall(state, 'read_file', toolCallSignature({ path: 'a.ts' }), config);
  assert.equal(state.consecutiveIdenticalCount, 2);

  checkRepeatedToolCall(state, 'read_file', toolCallSignature({ path: 'b.ts' }), config);
  assert.equal(state.consecutiveIdenticalCount, 1);
});

test('identical calls increment count', () => {
  const state = createLoopDetectionState();
  const sig = toolCallSignature({ path: 'foo.ts' });

  checkRepeatedToolCall(state, 'read_file', sig, config);
  assert.equal(state.consecutiveIdenticalCount, 1);

  checkRepeatedToolCall(state, 'read_file', sig, config);
  assert.equal(state.consecutiveIdenticalCount, 2);
});

test('soft warning at threshold 3', () => {
  const state = createLoopDetectionState();
  const sig = toolCallSignature({ path: 'foo.ts' });

  assert.equal(
    checkRepeatedToolCall(state, 'read_file', sig, config).softWarning,
    false,
  );
  assert.equal(
    checkRepeatedToolCall(state, 'read_file', sig, config).softWarning,
    false,
  );
  assert.equal(
    checkRepeatedToolCall(state, 'read_file', sig, config).softWarning,
    true,
  );
});

test('hard escalation at threshold 6', () => {
  const state = createLoopDetectionState();
  const sig = toolCallSignature({ path: 'foo.ts' });

  for (let i = 0; i < 5; i++) {
    const check = checkRepeatedToolCall(state, 'read_file', sig, config);
    assert.equal(check.hardEscalation, false);
  }
  const check = checkRepeatedToolCall(state, 'read_file', sig, config);
  assert.equal(check.hardEscalation, true);
});
