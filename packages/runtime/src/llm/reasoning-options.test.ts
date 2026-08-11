import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reasoningProviderOptions } from './reasoning-options.js';

test('kimi-k3 gets reasoning options', () => {
  const opts = reasoningProviderOptions('kimi-k3');
  assert.ok(opts);
  assert.ok(JSON.stringify(opts).includes('reasoning'));
});

test('north-mini-code-free gets reasoning options', () => {
  assert.ok(reasoningProviderOptions('north-mini-code-free'));
});

test('laguna-s-2.1-free gets reasoning options', () => {
  assert.ok(reasoningProviderOptions('laguna-s-2.1-free'));
});

test('thinkingmachines/inkling gets reasoning options', () => {
  assert.ok(reasoningProviderOptions('thinkingmachines/inkling'));
});

test('gpt-5.4-mini returns undefined', () => {
  assert.equal(reasoningProviderOptions('gpt-5.4-mini'), undefined);
});
