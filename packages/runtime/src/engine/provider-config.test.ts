import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import type { RuntimeConfig } from '../config.js';
import {
  applyProviderConfigUpdate,
  buildProviderConfigSnapshot,
} from './provider-config.js';

function runtime(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    apiKey: 'k',
    baseURL: 'https://opencode.ai/zen/v1',
    model: 'gpt-5.4-mini',
    models: { low: 'a', medium: 'b', high: 'c' },
    roleTiers: {
      communicator: 'low',
      orchestrator: 'low',
      planner: 'medium',
      reviewer: 'low',
      worker: 'medium',
      librarian: 'low',
    },
    modelPresetId: 'custom',
    execDir: path.join(os.tmpdir(), 'provider-config-test'),
    port: 4100,
    concurrency: 2,
    maxIterationsPerCall: 24,
    maxPlannerIterations: 18,
    maxRunMs: 420_000,
    maxRunsPerWorkstream: 60,
    resumeOnStartup: true,
    agentName: 'Test',
    diagnostics: {
      enabled: true,
      timeoutMs: 20_000,
      maxPerFile: 20,
      typescript: true,
    },
    contextBorrowing: {
      microcompactEnabled: true,
      fileCacheMaxEntries: 64,
      requireRipgrep: true,
      toolResults: { maxCharsPerInvocation: 12_000, maxCharsPerRun: 80_000 },
    },
    codemode: {
      timeoutMs: 120_000,
      maxToolCalls: 32,
      maxOutputBytes: 12_000,
    },
    identityDir: process.cwd(),
    quota: {
      reservePercent: 10,
      routes: [
        {
          id: 'primary',
          accountId: 'opencode-zen',
          mode: 'metered',
          execution: 'llm',
          llm: { baseURL: 'https://opencode.ai/zen/v1' },
          presetId: 'async-economy',
          models: { low: 'a', medium: 'b', high: 'c' },
          windows: [
            {
              id: 'daily-budget',
              unit: 'dollars',
              period: 'daily',
              scope: 'global',
              limit: 10,
              blockAtPercent: 90,
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

test('buildProviderConfigSnapshot includes routes and presets', () => {
  const snap = buildProviderConfigSnapshot(runtime(), undefined);
  assert.equal(snap.modelPresetId, 'custom');
  assert.ok(snap.availablePresets.some((p) => p.id === 'async-economy'));
  assert.equal(snap.quota.effective?.routes?.length, 1);
  assert.equal(snap.quota.effective?.routes?.[0]?.accountId, 'opencode-zen');
});

test('applyProviderConfigUpdate applies preset to models and primary route', () => {
  const cfg = runtime();
  const changes = applyProviderConfigUpdate(cfg, {
    applyPreset: 'ultra-budget',
  });
  assert.match(changes.join(' '), /ultra-budget/);
  assert.equal(cfg.modelPresetId, 'ultra-budget');
  assert.equal(cfg.models.medium, 'gpt-5.1-codex-mini');
  assert.equal(cfg.quota?.routes?.[0]?.presetId, 'ultra-budget');
});

test('applyProviderConfigUpdate changes daily budget on primary route', () => {
  const cfg = runtime();
  applyProviderConfigUpdate(cfg, { dailyBudgetLimit: 25 });
  const window = cfg.quota?.routes?.[0]?.windows.find(
    (w) => w.id === 'daily-budget',
  );
  assert.equal(window?.limit, 25);
});

test('applyProviderConfigUpdate rejects empty updates', () => {
  assert.throws(
    () => applyProviderConfigUpdate(runtime(), {}),
    /no configuration changes/,
  );
});
