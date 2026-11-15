import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'vitest';
import { loadConfig } from '../config.js';
import { Store } from '../storage/store.js';
import { createProviderConfigTools } from '../tools/config.js';
import { Engine } from './engine.js';
import type { ExecutionRouteConfig } from './quota-types.js';

const ASYNC_ECONOMY_MODELS = {
  low: 'gpt-5-nano',
  medium: 'gpt-5.4-mini',
  high: 'gpt-5.4',
} as const;

const ROLE_TIERS = {
  communicator: 'low',
  orchestrator: 'low',
  planner: 'medium',
  reviewer: 'low',
  worker: 'medium',
  librarian: 'low',
} as const;

function primaryRoute(dailyLimit = 10): ExecutionRouteConfig {
  return {
    id: 'primary',
    accountId: 'opencode-zen',
    mode: 'metered',
    execution: 'llm',
    llm: { baseURL: 'https://opencode.ai/zen/v1' },
    presetId: 'async-economy',
    models: { ...ASYNC_ECONOMY_MODELS },
    roleTiers: { ...ROLE_TIERS },
    windows: [
      {
        id: 'daily-budget',
        unit: 'dollars',
        period: 'daily',
        scope: 'global',
        limit: dailyLimit,
        warnAtPercent: 70,
        blockAtPercent: 90,
      },
    ],
  };
}

async function buildEngine(identityDir: string, dailyLimit = 10) {
  const execDir = path.join(identityDir, 'exec');
  await fs.mkdir(execDir, { recursive: true });
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: execDir,
    ARTIFICER_IDENTITY_DIR: identityDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
    MODEL_PRESET: 'async-economy',
  });
  config.quota = {
    reservePercent: 10,
    routes: [primaryRoute(dailyLimit)],
  };
  const store = new Store(execDir);
  await store.init();
  return {
    engine: new Engine(config, store),
    store,
    configPath: path.join(identityDir, 'artificer.config.json'),
  };
}

let identityDir: string;

beforeEach(async () => {
  identityDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-provider-config-'),
  );
});

afterEach(async () => {
  await fs.rm(identityDir, { recursive: true, force: true });
});

test('provider config self-service: engine API, communicator tools, and persistence', async () => {
  const { engine, store, configPath } = await buildEngine(identityDir, 10);

  const budgetSummary = await engine.updateProviderConfig({
    dailyBudgetLimit: 25,
  });
  assert.match(budgetSummary, /daily budget.*25/i);

  let onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
    quota: { routes: ExecutionRouteConfig[] };
  };
  const daily = onDisk.quota.routes[0]?.windows.find(
    (w) => w.id === 'daily-budget',
  );
  assert.equal(daily?.limit, 25);

  const run = await store.createRun({
    role: 'communicator',
    task: 'change preset',
  });
  const tools = createProviderConfigTools({
    engine,
    run,
    workspaceDir: '/tmp',
  });
  const getConfig = tools.find((t) => t.name === 'get_provider_config');
  const updateConfig = tools.find((t) => t.name === 'update_provider_config');
  assert.ok(getConfig, 'get_provider_config tool is registered');
  assert.ok(updateConfig, 'update_provider_config tool is registered');

  const before = JSON.parse(await getConfig.handler({})) as {
    modelPresetId: string;
    quota: { effective: { routes: ExecutionRouteConfig[] } };
  };
  assert.equal(before.modelPresetId, 'async-economy');
  assert.equal(before.quota.effective.routes[0]?.presetId, 'async-economy');
  assert.equal(before.quota.effective.routes[0]?.windows[0]?.limit, 25);

  const presetResult = await updateConfig.handler({
    applyPreset: 'go-economy',
  });
  assert.match(presetResult, /Configuration updated.*go-economy/);

  onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
    preset: string;
    quota: { routes: ExecutionRouteConfig[]; reservePercent?: number };
  };
  assert.equal(onDisk.preset, 'go-economy');
  assert.equal(onDisk.quota.routes[0]?.presetId, 'go-economy');
  assert.equal(engine.config.modelPresetId, 'go-economy');

  const reserveResult = await updateConfig.handler({ reservePercent: 15 });
  assert.match(reserveResult, /reservePercent.*15/);

  onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
    preset: string;
    quota: { routes: ExecutionRouteConfig[]; reservePercent?: number };
  };
  assert.equal(onDisk.quota.reservePercent, 15);

  const snapshot = engine.getProviderConfig();
  assert.equal(snapshot.modelPresetId, 'go-economy');
  assert.equal(snapshot.quota.configured?.reservePercent, 15);
});
