import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APICallError } from 'ai';
import {
  formatCallError,
  insufficientBalanceUserMessage,
  isInsufficientBalanceError,
} from './errors.js';

test('isInsufficientBalanceError detects APICallError 402', () => {
  const err = new APICallError({
    message: 'Provider returned error',
    url: 'https://opencode.ai/zen/v1/messages',
    requestBodyValues: {},
    statusCode: 402,
    responseBody:
      '{"error":{"message":"Insufficient Balance","type":"unknown_error"}}',
  });
  assert.equal(isInsufficientBalanceError(err), true);
});

test('isInsufficientBalanceError detects message text', () => {
  assert.equal(
    isInsufficientBalanceError(new Error('AI_APICallError: Insufficient Balance')),
    true,
  );
  assert.equal(
    isInsufficientBalanceError(
      'HTTP 402 — {"error":{"message":"Insufficient account balance","type":"insufficient_balance"}}',
    ),
    true,
  );
});

test('isInsufficientBalanceError ignores unrelated failures', () => {
  assert.equal(isInsufficientBalanceError(new Error('rate limit exceeded')), false);
  assert.equal(
    isInsufficientBalanceError(
      new APICallError({
        message: 'Unauthorized',
        url: 'https://example.com',
        requestBodyValues: {},
        statusCode: 401,
      }),
    ),
    false,
  );
});

test('formatCallError includes status and response body for APICallError', () => {
  const err = new APICallError({
    message: 'Insufficient Balance',
    url: 'https://opencode.ai/zen/v1/messages',
    requestBodyValues: {},
    statusCode: 402,
    responseBody: '{"error":{"message":"Insufficient Balance"}}',
  });
  const formatted = formatCallError(err);
  assert.match(formatted, /Insufficient Balance/);
  assert.match(formatted, /402/);
});

test('insufficientBalanceUserMessage mentions model and workstream', () => {
  const msg = insufficientBalanceUserMessage({
    model: 'gpt-5.4-mini',
    workstreamTitle: 'Fix login bug',
  });
  assert.match(msg, /gpt-5\.4-mini/);
  assert.match(msg, /Fix login bug/);
  assert.match(msg, /opencode\.ai/);
});
