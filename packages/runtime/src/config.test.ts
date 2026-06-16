import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.js';

test('github.watchIntervalMs is undefined by default even with a token configured', () => {
  const config = loadConfig({
    LLM_API_KEY: 'test-key',
    GITHUB_TOKEN: 'gh-token',
  });
  assert.equal(config.github?.watchIntervalMs, undefined);
});

test('GITHUB_WATCH_INTERVAL_MS sets github.watchIntervalMs when a token is configured', () => {
  const config = loadConfig({
    LLM_API_KEY: 'test-key',
    GITHUB_TOKEN: 'gh-token',
    GITHUB_WATCH_INTERVAL_MS: '60000',
  });
  assert.equal(config.github?.watchIntervalMs, 60000);
});

test('GITHUB_WATCH_INTERVAL_MS is ignored when no GitHub token is configured', () => {
  const config = loadConfig({
    LLM_API_KEY: 'test-key',
    GITHUB_WATCH_INTERVAL_MS: '60000',
  });
  assert.equal(config.github, undefined);
});
