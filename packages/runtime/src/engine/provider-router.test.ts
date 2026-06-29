import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { RuntimeConfig } from '../config.js';
import { QuotaLedger } from './quota-ledger.js';
import { ProviderRouter, executorForRoute } from './provider-router.js';
import { normalizeQuotaConfig } from './route-config.js';
import type { ExecutionRouteConfig, QuotaConfig } from './quota-types.js';
import type { WorkerExecutor } from './executor.js';

function runtimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    apiKey: 'test-key',
    baseURL: 'https://opencode.ai/zen/go/v1',
    model: 'kimi-k2.6',
    models: { low: 'a', medium: 'b', high: 'c' },
    roleTiers: {
      communicator: 'low',
      orchestrator: 'low',
      planner: 'medium',
      reviewer: 'low',
      worker: 'medium',
      librarian: 'low',
    },
    modelPresetId: 'go-economy',
    execDir: path.join(os.tmpdir(), 'quota-router-test'),
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

const quotaConfig: QuotaConfig = {
  reservePercent: 10,
  accounts: [
    {
      id: 'opencode-go',
      mode: 'windowed',
      onExhausted: 'failover',
      windows: [
        {
          id: 'rolling5h',
          unit: 'dollars',
          period: 'rolling5h',
          scope: 'global',
          limit: 12,
          blockAtPercent: 90,
        },
      ],
      failover: [
        {
          id: 'zen-failover',
          accountId: 'opencode-zen',
          executor: 'llm',
          llm: {
            baseURL: 'https://opencode.ai/zen/v1',
            preset: 'async-economy',
          },
          onExhausted: 'wait',
        },
      ],
    },
    {
      id: 'opencode-zen',
      mode: 'metered',
      windows: [
        {
          id: 'daily',
          unit: 'dollars',
          period: 'daily',
          scope: 'global',
          limit: 100,
          blockAtPercent: 90,
        },
      ],
    },
  ],
};

test('ProviderRouter uses primary when headroom exists', () => {
  const cfg = runtimeConfig();
  const built = normalizeQuotaConfig(quotaConfig, cfg);
  const ledger = new QuotaLedger(built, ':memory:');
  const router = new ProviderRouter(
    cfg,
    ledger,
    built.routes!,
    { LLM_API_KEY: 'k' },
    () => undefined,
  );
  const route = router.resolve({ role: 'worker', tier: 'medium' });
  assert.equal(route?.profileId, 'primary');
  assert.equal(route?.accountId, 'opencode-go');
});

test('ProviderRouter fails over when primary exhausted', () => {
  const cfg = runtimeConfig();
  const built = normalizeQuotaConfig(quotaConfig, cfg);
  const ledger = new QuotaLedger(built, ':memory:');
  ledger.markAccountExhausted('opencode-go');
  const router = new ProviderRouter(
    cfg,
    ledger,
    built.routes!,
    { LLM_API_KEY: 'k', ZEN_API_KEY: 'zen' },
    () => undefined,
  );
  const route = router.resolve({ role: 'worker', tier: 'medium' });
  assert.equal(route?.profileId, 'zen-failover');
  assert.equal(route?.accountId, 'opencode-zen');
  assert.equal(route?.useLlmForWorkRoles, true);
  assert.equal(route?.baseURL, 'https://opencode.ai/zen/v1');
});

test('ProviderRouter returns null when only route exhausted', () => {
  const waitConfig: QuotaConfig = {
    accounts: [
      {
        id: 'opencode-go',
        mode: 'windowed',
        onExhausted: 'wait',
        windows: [
          {
            id: 'rolling5h',
            unit: 'dollars',
            period: 'rolling5h',
            scope: 'global',
            limit: 12,
            blockAtPercent: 90,
          },
        ],
      },
    ],
  };
  const cfg = runtimeConfig();
  const built = normalizeQuotaConfig(waitConfig, cfg);
  const ledger = new QuotaLedger(built, ':memory:');
  ledger.markAccountExhausted('opencode-go');
  const router = new ProviderRouter(
    cfg,
    ledger,
    built.routes!,
    {},
    () => undefined,
  );
  assert.equal(router.resolve({ role: 'worker', tier: 'medium' }), null);
});

function dailyWindow(id: string, limit: number) {
  return {
    id,
    unit: 'dollars' as const,
    period: 'daily' as const,
    scope: 'global' as const,
    limit,
    blockAtPercent: 90,
  };
}

function nativeRoutes(): ExecutionRouteConfig[] {
  return [
    {
      id: 'primary',
      accountId: 'route-a',
      mode: 'metered',
      execution: 'llm',
      llm: { baseURL: 'https://opencode.ai/zen/go/v1' },
      presetId: 'go-economy',
      models: { low: 'a', medium: 'b', high: 'c' },
      windows: [dailyWindow('daily-a', 50)],
    },
    {
      id: 'zen-failover',
      accountId: 'route-b',
      mode: 'metered',
      execution: 'llm',
      llm: { baseURL: 'https://opencode.ai/zen/v1' },
      presetId: 'async-economy',
      models: { low: 'x', medium: 'y', high: 'z' },
      windows: [dailyWindow('daily-b', 50)],
    },
    {
      id: 'last-resort',
      accountId: 'route-c',
      mode: 'metered',
      execution: 'llm',
      llm: { baseURL: 'https://api.anthropic.com/v1' },
      presetId: 'custom',
      models: { low: 'l', medium: 'm', high: 'h' },
      windows: [dailyWindow('daily-c', 50)],
    },
  ];
}

function routerForRoutes(
  routes: ExecutionRouteConfig[],
  ledger: QuotaLedger,
  cfg = runtimeConfig(),
) {
  return new ProviderRouter(
    cfg,
    ledger,
    routes,
    { LLM_API_KEY: 'k', ZEN_API_KEY: 'zen', ANTHROPIC_API_KEY: 'ant' },
    () => undefined,
  );
}

test('ProviderRouter walks native routes[] in order', () => {
  const cfg = runtimeConfig();
  const routes = nativeRoutes();
  const built = normalizeQuotaConfig({ routes }, cfg);
  const ledger = new QuotaLedger(built, ':memory:');
  const router = routerForRoutes(routes, ledger, cfg);

  const primary = router.resolve({ role: 'worker', tier: 'medium' });
  assert.equal(primary?.profileId, 'primary');
  assert.equal(primary?.accountId, 'route-a');
});

test('ProviderRouter skips to third route when first two exhausted', () => {
  const cfg = runtimeConfig();
  const routes = nativeRoutes();
  const built = normalizeQuotaConfig({ routes }, cfg);
  const ledger = new QuotaLedger(built, ':memory:');
  ledger.markAccountExhausted('route-a');
  ledger.markAccountExhausted('route-b');
  const router = routerForRoutes(routes, ledger, cfg);

  const route = router.resolve({ role: 'worker', tier: 'medium' });
  assert.equal(route?.profileId, 'last-resort');
  assert.equal(route?.accountId, 'route-c');
  assert.equal(route?.baseURL, 'https://api.anthropic.com/v1');
});

test('ProviderRouter skips role-restricted routes', () => {
  const cfg = runtimeConfig();
  const routes: ExecutionRouteConfig[] = [
    {
      id: 'comms-only',
      accountId: 'route-a',
      mode: 'metered',
      execution: 'llm',
      llm: { baseURL: 'https://opencode.ai/zen/go/v1' },
      presetId: 'custom',
      models: { low: 'a', medium: 'b', high: 'c' },
      roles: ['communicator'],
      windows: [dailyWindow('daily-a', 50)],
    },
    {
      id: 'worker-route',
      accountId: 'route-b',
      mode: 'metered',
      execution: 'llm',
      llm: { baseURL: 'https://opencode.ai/zen/v1' },
      presetId: 'custom',
      models: { low: 'x', medium: 'y', high: 'z' },
      windows: [dailyWindow('daily-b', 50)],
    },
  ];
  const built = normalizeQuotaConfig({ routes }, cfg);
  const ledger = new QuotaLedger(built, ':memory:');
  const router = routerForRoutes(routes, ledger, cfg);

  const route = router.resolve({ role: 'worker', tier: 'medium' });
  assert.equal(route?.profileId, 'worker-route');
  assert.equal(route?.accountId, 'route-b');
});

test('ProviderRouter dispatches agent executor route without LLM loop', () => {
  const cfg = runtimeConfig();
  const routes: ExecutionRouteConfig[] = [
    {
      id: 'primary',
      accountId: 'opencode-go',
      mode: 'windowed',
      execution: 'llm',
      llm: { baseURL: 'https://opencode.ai/zen/go/v1' },
      presetId: 'go-economy',
      models: { low: 'a', medium: 'b', high: 'c' },
      windows: [
        {
          id: 'rolling5h',
          unit: 'dollars',
          period: 'rolling5h',
          scope: 'global',
          limit: 12,
          blockAtPercent: 90,
        },
      ],
    },
    {
      id: 'cursor-failover',
      accountId: 'cursor-agent',
      mode: 'opaque',
      execution: 'cursor-agent',
      presetId: 'custom',
      models: { low: 'a', medium: 'b', high: 'c' },
      windows: [
        {
          id: 'weekly-requests',
          unit: 'requests',
          period: 'weekly',
          scope: 'global',
          limit: 200,
          blockAtPercent: 90,
        },
      ],
    },
  ];
  const built = normalizeQuotaConfig({ routes }, cfg);
  const ledger = new QuotaLedger(built, ':memory:');
  ledger.markAccountExhausted('opencode-go');
  const mockExecutor: WorkerExecutor = {
    name: 'cursor-agent',
    execute: async () => ({ text: 'done' }),
  };
  const router = new ProviderRouter(
    cfg,
    ledger,
    routes,
    {},
    () => mockExecutor,
  );

  const route = router.resolve({ role: 'worker', tier: 'medium' });
  assert.equal(route?.profileId, 'cursor-failover');
  assert.equal(route?.useLlmForWorkRoles, false);
  assert.equal(route?.executorName, 'cursor-agent');
  assert.equal(
    executorForRoute(route!, () => mockExecutor)?.name,
    'cursor-agent',
  );
});

test('ProviderRouter applies failover route preset models', () => {
  const cfg = runtimeConfig();
  const built = normalizeQuotaConfig(quotaConfig, cfg);
  const ledger = new QuotaLedger(built, ':memory:');
  ledger.markAccountExhausted('opencode-go');
  const router = routerForRoutes(built.routes!, ledger, cfg);

  const route = router.resolve({ role: 'worker', tier: 'medium' });
  assert.equal(route?.models.medium, 'gpt-5.4-mini');
  assert.equal(route?.roleTiers.worker, 'medium');
});
