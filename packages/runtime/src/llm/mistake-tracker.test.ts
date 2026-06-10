import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyStepFromToolResults,
  createMistakeTrackerState,
  recordStepOutcome,
} from './mistake-tracker.js';

test('productive step resets consecutive mistake counter', () => {
  const state = createMistakeTrackerState();
  recordStepOutcome(state, 'api_error', 4);
  recordStepOutcome(state, 'all_tools_failed', 4);
  assert.equal(state.consecutiveMistakes, 2);

  const result = recordStepOutcome(state, 'productive', 4);
  assert.equal(state.consecutiveMistakes, 0);
  assert.equal(result.shouldAbort, false);
});

test('failure outcomes increment consecutive mistakes', () => {
  const state = createMistakeTrackerState();

  recordStepOutcome(state, 'api_error', 4);
  assert.equal(state.consecutiveMistakes, 1);

  recordStepOutcome(state, 'all_tools_failed', 4);
  assert.equal(state.consecutiveMistakes, 2);

  recordStepOutcome(state, 'invalid_tool_calls', 4);
  assert.equal(state.consecutiveMistakes, 3);
});

test('abort when consecutive mistakes reach max', () => {
  const state = createMistakeTrackerState();
  const max = 3;

  assert.equal(recordStepOutcome(state, 'api_error', max).shouldAbort, false);
  assert.equal(recordStepOutcome(state, 'api_error', max).shouldAbort, false);
  const result = recordStepOutcome(state, 'all_tools_failed', max);

  assert.equal(state.consecutiveMistakes, 3);
  assert.equal(result.shouldAbort, true);
  assert.match(result.reason ?? '', /3\/3 consecutive mistakes \(all_tools_failed\)/);
});

test('classifyStepFromToolResults handles api, all-failed, and productive cases', () => {
  assert.equal(classifyStepFromToolResults([], 'error'), 'api_error');

  assert.equal(
    classifyStepFromToolResults(
      [{ output: 'Error: boom' }, { output: 'Error: bust', isError: true }],
      'tool-calls',
    ),
    'all_tools_failed',
  );

  assert.equal(
    classifyStepFromToolResults([{ output: 'ok' }, { output: 'Error: partial' }], 'tool-calls'),
    'productive',
  );

  assert.equal(classifyStepFromToolResults([], 'stop'), 'productive');
});
