import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { RuntimeConfig } from '../config.js';
import {
  accountsFromRoutes,
  modelsForRoute,
  normalizeQuotaConfig,
  routesFromLegacyQuota,
  stripDerivedQuotaFields,
  syncPrimaryRouteToRuntime,
  validateRoutes,
} from './route-config.js';
import type { ExecutionRouteConfig, QuotaConfig, QuotaWindowConfig } from './quota-types.js';

function runtime(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    apiKey: 'k',
    baseURL: 'https://opencode.ai/zen/go/v1',
    model: 'm-medium',
    models: { low: 'm-low', medium: 'm-medium', high: 'm-high' },
    roleTiers: {
      communicator: 'low',
      orchestrator: 'low',
      planner: 'medium',
      reviewer: 'low',
      worker: 'medium',
      librarian: 'low',
    },
    modelPresetId: 'go-economy',
    execDir: path.join(os.tmpdir(), 'route-config-test'),
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
    identityDir: process.cwd(),
    ...overrides,
  };
}

function window(id: string, limit = 100): QuotaWindowConfig {
  return {
    id,
    unit: 'dollars',
    period: 'daily',
    scope: 'global',
    limit,
    blockAtPercent: 90,
  };
}

function llmRoute(
  overrides: Partial<ExecutionRouteConfig> & Pick<ExecutionRouteConfig, 'id' | 'accountId'>,
): ExecutionRouteConfig {
  return {
    mode: 'metered',
    windows: [window('daily')],
    execution: 'llm',
    llm: { baseURL: 'https://opencode.ai/zen/v1' },
    presetId: 'custom',
    models: { low: 'a', medium: 'b', high: 'c' },
    ...overrides,
  };
}

test('routesFromLegacyQuota flattens nested failover into ordered routes', () => {
  const cfg = runtime();
  const quota: QuotaConfig = {
    accounts: [
      {
        id: 'opencode-go',
        mode: 'windowed',
        onExhausted: 'failover',
        windows: [window('rolling5h', 12)],
        failover: [
          {
            id: 'zen-failover',
            accountId: 'opencode-zen',
            executor: 'llm',
            llm: {
              baseURL: 'https://opencode.ai/zen/v1',
              preset: 'async-economy',
            },
          },
        ],
      },
      {
        id: 'opencode-zen',
        mode: 'metered',
        windows: [window('daily', 100)],
      },
    ],
  };

  const routes = routesFromLegacyQuota(quota, cfg);
  assert.equal(routes.length, 2);
  assert.equal(routes[0]!.id, 'primary');
  assert.equal(routes[0]!.accountId, 'opencode-go');
  assert.equal(routes[1]!.id, 'zen-failover');
  assert.equal(routes[1]!.accountId, 'opencode-zen');
  assert.equal(routes[1]!.llm?.baseURL, 'https://opencode.ai/zen/v1');
  assert.equal(routes[1]!.presetId, 'async-economy');
});

test('routesFromLegacyQuota passes through native routes unchanged', () => {
  const cfg = runtime();
  const native: ExecutionRouteConfig[] = [
    llmRoute({ id: 'primary', accountId: 'go' }),
    llmRoute({ id: 'backup', accountId: 'zen' }),
  ];
  const routes = routesFromLegacyQuota({ routes: native }, cfg);
  assert.deepEqual(routes, native);
});

test('accountsFromRoutes assigns failover then wait onExhausted by position', () => {
  const accounts = accountsFromRoutes([
    llmRoute({ id: 'a', accountId: 'acct-a' }),
    llmRoute({ id: 'b', accountId: 'acct-b' }),
    llmRoute({ id: 'c', accountId: 'acct-c' }),
  ]);
  assert.equal(accounts[0]!.onExhausted, 'failover');
  assert.equal(accounts[1]!.onExhausted, 'failover');
  assert.equal(accounts[2]!.onExhausted, 'wait');
});

test('normalizeQuotaConfig derives accounts from routes', () => {
  const cfg = runtime();
  const normalized = normalizeQuotaConfig(
    {
      reservePercent: 15,
      routes: [
        llmRoute({ id: 'primary', accountId: 'go' }),
        llmRoute({ id: 'zen', accountId: 'zen' }),
      ],
    },
    cfg,
  );
  assert.equal(normalized.reservePercent, 15);
  assert.equal(normalized.routes?.length, 2);
  assert.equal(normalized.accounts?.length, 2);
  assert.equal(normalized.accounts?.[0]!.id, 'go');
  assert.equal(normalized.accounts?.[1]!.id, 'zen');
});

test('modelsForRoute merges preset tiers with explicit overrides', () => {
  const models = modelsForRoute(
    {
      presetId: 'async-economy',
      models: { low: 'custom-low', medium: '', high: 'c' },
    },
    { low: 'x', medium: 'y', high: 'z' },
  );
  assert.equal(models.low, 'custom-low');
  assert.equal(models.medium, 'gpt-5.4-mini');
  assert.equal(models.high, 'c');
});

test('syncPrimaryRouteToRuntime copies route models and llm settings', () => {
  const cfg = runtime();
  syncPrimaryRouteToRuntime(cfg, {
    ...llmRoute({ id: 'primary', accountId: 'go' }),
    presetId: 'async-economy',
    models: { low: 'a', medium: 'b', high: 'c' },
    llm: { baseURL: 'https://opencode.ai/zen/v1' },
    execution: 'llm',
  });
  assert.equal(cfg.baseURL, 'https://opencode.ai/zen/v1');
  assert.equal(cfg.modelPresetId, 'async-economy');
  assert.equal(cfg.models.medium, 'b');
});

test('syncPrimaryRouteToRuntime sets executor for agent routes', () => {
  const cfg = runtime();
  syncPrimaryRouteToRuntime(cfg, {
    id: 'cursor',
    accountId: 'cursor-agent',
    mode: 'opaque',
    windows: [window('weekly-requests', 200)],
    execution: 'cursor-agent',
    presetId: 'custom',
    models: { low: 'a', medium: 'b', high: 'c' },
  });
  assert.equal(cfg.executor, 'cursor-agent');
});

test('stripDerivedQuotaFields omits ledger accounts', () => {
  const stripped = stripDerivedQuotaFields({
    reservePercent: 10,
    routes: [llmRoute({ id: 'primary', accountId: 'go' })],
    accounts: [{ id: 'go', mode: 'metered', windows: [window('daily')] }],
  });
  assert.deepEqual(stripped, {
    reservePercent: 10,
    defaultEstimateDollars: undefined,
    routes: [llmRoute({ id: 'primary', accountId: 'go' })],
  });
  assert.equal((stripped as QuotaConfig).accounts, undefined);
});

test('validateRoutes rejects duplicate ids and missing llm baseURL', () => {
  assert.throws(
    () =>
      validateRoutes([
        llmRoute({ id: 'dup', accountId: 'a' }),
        llmRoute({ id: 'dup', accountId: 'b' }),
      ]),
    /duplicate route id/,
  );

  assert.throws(
    () =>
      validateRoutes([
        {
          id: 'agent',
          accountId: 'cursor-agent',
          mode: 'opaque',
          windows: [window('weekly')],
          execution: 'llm',
          presetId: 'custom',
          models: { low: 'a', medium: 'b', high: 'c' },
        },
      ]),
    /requires llm.baseURL/,
  );

  assert.throws(
    () =>
      validateRoutes([
        llmRoute({ id: 'ok', accountId: 'a', windows: [] }),
      ]),
    /at least one quota window/,
  );
});

test('validateRoutes allows agent routes without llm block', () => {
  assert.doesNotThrow(() =>
    validateRoutes([
      {
        id: 'cursor',
        accountId: 'cursor-agent',
        mode: 'opaque',
        windows: [window('weekly-requests', 200)],
        execution: 'cursor-agent',
        presetId: 'custom',
        models: { low: 'a', medium: 'b', high: 'c' },
      },
    ]),
  );
});
