import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  loadConfig,
  loadConfigWithIdentityDefinition,
  mergeWithDefinition,
} from './config.js';

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
    [
      '[artificer] invalid identity.pullInterval "later"; periodic pulling is disabled.',
    ],
  ]);
});

test('codemode limits default to 120s / 32 calls / 12000 bytes', () => {
  const config = loadConfig({ LLM_API_KEY: 'test-key' });
  assert.deepEqual(config.codemode, {
    timeoutMs: 120_000,
    maxToolCalls: 32,
    maxOutputBytes: 12_000,
  });
});

test('RUNTIME_CODEMODE_* env vars override defaults', () => {
  const config = loadConfig({
    LLM_API_KEY: 'test-key',
    RUNTIME_CODEMODE_TIMEOUT_MS: '5000',
    RUNTIME_CODEMODE_MAX_TOOL_CALLS: '4',
    RUNTIME_CODEMODE_MAX_OUTPUT_BYTES: '100',
  });
  assert.deepEqual(config.codemode, {
    timeoutMs: 5_000,
    maxToolCalls: 4,
    maxOutputBytes: 100,
  });
});

test('invalid RUNTIME_CODEMODE_* values warn and fall back to defaults', () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const config = loadConfig({
      LLM_API_KEY: 'test-key',
      RUNTIME_CODEMODE_TIMEOUT_MS: 'nope',
      RUNTIME_CODEMODE_MAX_TOOL_CALLS: '-1',
      RUNTIME_CODEMODE_MAX_OUTPUT_BYTES: '0.5',
    });
    assert.deepEqual(config.codemode, {
      timeoutMs: 120_000,
      maxToolCalls: 32,
      maxOutputBytes: 12_000,
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 3);
  assert.match(String(warnings[0][0]), /RUNTIME_CODEMODE_TIMEOUT_MS/);
  assert.match(String(warnings[1][0]), /RUNTIME_CODEMODE_MAX_TOOL_CALLS/);
  assert.match(String(warnings[2][0]), /RUNTIME_CODEMODE_MAX_OUTPUT_BYTES/);
});

test('timeoutMs of 0 is invalid and falls back', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const config = loadConfig({
      LLM_API_KEY: 'test-key',
      RUNTIME_CODEMODE_TIMEOUT_MS: '0',
    });
    assert.equal(config.codemode.timeoutMs, 120_000);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadConfigWithIdentityDefinition reads executor and quota from artificer.config.json', (t) => {
  const identityDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'artificer-config-identity-'),
  );
  t.after(() => fs.rmSync(identityDir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(identityDir, 'artificer.config.json'),
    JSON.stringify({
      name: 'ConfigBot',
      executor: { type: 'opencode', model: 'opencode/gpt-5' },
      quota: { reservePercent: 15 },
    }),
  );

  const config = loadConfigWithIdentityDefinition({
    LLM_API_KEY: 'test-key',
    ARTIFICER_IDENTITY_DIR: identityDir,
  });

  assert.equal(config.agentName, 'ConfigBot');
  assert.equal(config.identityDir, identityDir);
  assert.deepEqual(config.executor, {
    type: 'opencode',
    model: 'opencode/gpt-5',
  });
  assert.deepEqual(config.quota, { reservePercent: 15 });
});
