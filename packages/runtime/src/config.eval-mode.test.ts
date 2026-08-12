import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const minimalEnv = { LLM_API_KEY: 'test-key' };

test('loadConfig sets evalMode from RUNTIME_EVAL_MODE', () => {
  const cfg = loadConfig({
    ...minimalEnv,
    RUNTIME_EVAL_MODE: 'true',
  });
  assert.equal(cfg.evalMode, true);
});

test('evalMode defaults false', () => {
  const cfg = loadConfig(minimalEnv);
  assert.equal(cfg.evalMode, false);
});
