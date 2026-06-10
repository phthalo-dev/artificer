import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage } from 'ai';
import { estimateTokens, summarizeStepRequest } from './request-diagnostics.js';

test('estimateTokens rounds up', () => {
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(1), 1);
  assert.equal(estimateTokens(3), 1);
  assert.equal(estimateTokens(4), 2);
  assert.equal(estimateTokens(7), 3);
});

test('summarizeStepRequest counts tool results', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'a1',
          toolName: 'read_file',
          output: { type: 'text', value: 'abc' },
        },
        {
          type: 'tool-result',
          toolCallId: 'a2',
          toolName: 'run_shell',
          output: { type: 'text', value: 'x'.repeat(100) },
        },
      ],
    },
  ] as ModelMessage[];

  const summary = summarizeStepRequest(messages, undefined, 1);

  assert.equal(summary.messageChars, 5);
  assert.equal(summary.toolResultChars, 103);
  assert.equal(summary.largestToolResults[0]?.toolName, 'run_shell');
  assert.equal(summary.largestToolResults[0]?.chars, 100);
  assert.equal(summary.largestToolResults[1]?.toolName, 'read_file');
  assert.equal(summary.largestToolResults[1]?.chars, 3);
  assert.equal(summary.estimatedTokens, estimateTokens(5 + 103));
});

test('system chars included', () => {
  const messages = [{ role: 'user', content: 'hi' }] as ModelMessage[];
  const system = 'system prompt';

  const summary = summarizeStepRequest(messages, system, 0);

  assert.equal(summary.systemChars, system.length);
  assert.equal(summary.estimatedTokens, estimateTokens(system.length + 2));
});
