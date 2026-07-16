import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, mergeWithDefinition } from './config.js';

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

test('parseDuration accepts day units', async () => {
  const { parseDuration } = await import('./config.js');
  assert.equal(parseDuration('1d'), 86_400_000);
  assert.equal(parseDuration('2d'), 172_800_000);
  assert.equal(parseDuration('1h'), 3_600_000);
  assert.equal(parseDuration('nope'), undefined);
});

test('identity.pullInterval resolves to pullIntervalMs', () => {
  const config = mergeWithDefinition(
    {
      name: 'test',
      identity: { pullInterval: '5m' },
    },
    { LLM_API_KEY: 'test-key' },
  );
  assert.equal(config.identity?.pullIntervalMs, 300_000);
});

test('invalid identity.pullInterval emits a warning', () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    mergeWithDefinition(
      {
        name: 'test',
        identity: { pullInterval: 'later' },
      },
      { LLM_API_KEY: 'test-key' },
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(warnings, [
    ['[artificer] invalid identity.pullInterval "later"; periodic pulling is disabled.'],
  ]);
});
