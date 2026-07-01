import type { RuntimeConfig } from '../config.js';
import type { ExecutorConfig } from '../api/types.js';
import { cloneRoleTiers, getPreset } from './presets.js';
import type { ModelTier, ModelTiers } from './models.js';
import type { RoleName } from '../storage/types.js';
import {
  primaryAccountIdFor,
  defaultMode,
  defaultWindowsForPrimary,
  executorAccountId,
} from './quota-config-helpers.js';
import type {
  ExecutionRouteConfig,
  FailoverTargetConfig,
  QuotaAccountConfig,
  QuotaConfig,
  QuotaWindowConfig,
} from './quota-types.js';

export function modelsForRoute(
  route: Pick<ExecutionRouteConfig, 'presetId' | 'models'>,
  fallback: ModelTiers,
): ModelTiers {
  if (route.presetId && route.presetId !== 'custom') {
    const preset = getPreset(route.presetId);
    if (preset) {
      return {
        low: route.models.low || preset.tiers.low,
        medium: route.models.medium || preset.tiers.medium,
        high: route.models.high || preset.tiers.high,
      };
    }
  }
  return { ...route.models };
}

export function roleTiersForRoute(
  route: Pick<ExecutionRouteConfig, 'presetId' | 'roleTiers'>,
  fallback: Record<RoleName, ModelTier>,
): Record<RoleName, ModelTier> {
  if (route.roleTiers) return { ...route.roleTiers } as Record<RoleName, ModelTier>;
  if (route.presetId && route.presetId !== 'custom') {
    const preset = getPreset(route.presetId);
    if (preset) return cloneRoleTiers(preset.roleTiers);
  }
  return { ...fallback };
}

function failoverToRoute(
  target: FailoverTargetConfig,
  account: QuotaAccountConfig | undefined,
  fallback: ModelTiers,
  fallbackRoleTiers: Record<RoleName, ModelTier>,
): ExecutionRouteConfig {
  const presetId = target.llm?.preset;
  const preset = presetId ? getPreset(presetId) : undefined;
  const models: ModelTiers = {
    low: target.llm?.models?.low ?? preset?.tiers.low ?? fallback.low,
    medium: target.llm?.models?.medium ?? preset?.tiers.medium ?? fallback.medium,
    high: target.llm?.models?.high ?? preset?.tiers.high ?? fallback.high,
  };
  return {
    id: target.id,
    accountId: target.accountId,
    mode: account?.mode ?? 'metered',
    windows: account?.windows ?? [],
    execution: target.executor ?? 'llm',
    llm: target.llm?.baseURL
      ? { baseURL: target.llm.baseURL, apiKeyEnv: target.llm.apiKeyEnv }
      : undefined,
    presetId: presetId ?? 'custom',
    models,
    roleTiers: preset
      ? cloneRoleTiers(preset.roleTiers)
      : ({ ...fallbackRoleTiers } as Record<RoleName, ModelTier>),
    roles: target.roles,
    pollIntervalMs: account?.pollIntervalMs,
    unitWeights: account?.unitWeights,
  };
}

function primaryRouteFromRuntime(
  runtime: Pick<
    RuntimeConfig,
    'baseURL' | 'executor' | 'models' | 'roleTiers' | 'modelPresetId'
  >,
  account?: QuotaAccountConfig,
): ExecutionRouteConfig {
  const accountId =
    account?.id ?? primaryAccountIdFor(runtime);
  const windows =
    account?.windows ??
    defaultWindowsForPrimary(runtime.baseURL, runtime.executor);
  return {
    id: 'primary',
    accountId,
    mode: account?.mode ?? defaultMode(runtime.baseURL, runtime.executor),
    windows,
    execution: runtime.executor ?? 'llm',
    llm: { baseURL: runtime.baseURL },
    presetId: runtime.modelPresetId ?? 'custom',
    models: { ...runtime.models },
    roleTiers: { ...runtime.roleTiers },
    pollIntervalMs: account?.pollIntervalMs,
    unitWeights:
      account?.unitWeights ??
      (executorAccountId(runtime.executor)
        ? { planner: 1.5, worker: 1, reviewer: 0.5 }
        : undefined),
  };
}

/** Convert legacy accounts + nested failover into an ordered route chain. */
export function routesFromLegacyQuota(
  quota: QuotaConfig,
  runtime: Pick<
    RuntimeConfig,
    'baseURL' | 'executor' | 'models' | 'roleTiers' | 'modelPresetId'
  >,
): ExecutionRouteConfig[] {
  if (quota.routes?.length) return quota.routes.map((r) => ({ ...r }));

  const accounts = quota.accounts ?? [];
  if (accounts.length === 0) {
    return [primaryRouteFromRuntime(runtime)];
  }

  const primaryId = primaryAccountIdFor(runtime);
  const primaryAccount =
    accounts.find((a) => a.id === primaryId) ?? accounts[0];
  const routes: ExecutionRouteConfig[] = [
    primaryRouteFromRuntime(runtime, primaryAccount),
  ];

  for (const target of primaryAccount.failover ?? []) {
    const account = accounts.find((a) => a.id === target.accountId);
    routes.push(
      failoverToRoute(target, account, runtime.models, runtime.roleTiers),
    );
  }

  for (const account of accounts) {
    if (routes.some((r) => r.accountId === account.id)) continue;
    routes.push({
      id: account.id,
      accountId: account.id,
      mode: account.mode,
      windows: account.windows,
      execution: 'llm',
      llm: { baseURL: runtime.baseURL },
      presetId: 'custom',
      models: { ...runtime.models },
      roleTiers: { ...runtime.roleTiers },
      pollIntervalMs: account.pollIntervalMs,
      unitWeights: account.unitWeights,
    });
  }

  return routes;
}

/** Derive quota ledger accounts from ordered routes (one account per route). */
export function accountsFromRoutes(
  routes: ExecutionRouteConfig[],
): QuotaAccountConfig[] {
  return routes.map((route, index) => ({
    id: route.accountId,
    mode: route.mode,
    windows: route.windows,
    pollIntervalMs: route.pollIntervalMs,
    unitWeights: route.unitWeights,
    onExhausted:
      index < routes.length - 1 ? ('failover' as const) : ('wait' as const),
  }));
}

export function normalizeQuotaConfig(
  quota: QuotaConfig | undefined,
  runtime: Pick<
    RuntimeConfig,
    'baseURL' | 'executor' | 'models' | 'roleTiers' | 'modelPresetId'
  >,
): QuotaConfig {
  const routes = routesFromLegacyQuota(quota ?? { routes: [] }, runtime);
  return {
    reservePercent: quota?.reservePercent ?? 10,
    defaultEstimateDollars: quota?.defaultEstimateDollars,
    routes,
    accounts: accountsFromRoutes(routes),
  };
}

export function stripDerivedQuotaFields(
  config: QuotaConfig,
): Pick<QuotaConfig, 'reservePercent' | 'defaultEstimateDollars' | 'routes'> {
  return {
    reservePercent: config.reservePercent,
    defaultEstimateDollars: config.defaultEstimateDollars,
    routes: config.routes,
  };
}

export function syncPrimaryRouteToRuntime(
  runtime: RuntimeConfig,
  route: ExecutionRouteConfig | undefined,
): void {
  if (!route) return;
  runtime.models = modelsForRoute(route, runtime.models);
  runtime.roleTiers = roleTiersForRoute(route, runtime.roleTiers);
  runtime.model = runtime.models.medium;
  runtime.modelPresetId = route.presetId ?? 'custom';
  if (route.llm?.baseURL) runtime.baseURL = route.llm.baseURL;
  if (route.execution && route.execution !== 'llm') {
    runtime.executor = route.execution;
  } else if (route.execution === 'llm') {
    runtime.executor = undefined;
  }
}

export function validateRoutes(routes: ExecutionRouteConfig[]): void {
  if (routes.length === 0) {
    throw new Error('at least one execution route is required');
  }
  const ids = new Set<string>();
  const accountIds = new Set<string>();
  for (const route of routes) {
    if (ids.has(route.id)) {
      throw new Error(`duplicate route id "${route.id}"`);
    }
    ids.add(route.id);
    if (accountIds.has(route.accountId)) {
      throw new Error(`duplicate route accountId "${route.accountId}"`);
    }
    accountIds.add(route.accountId);
    const usesLlm =
      route.execution === 'llm' ||
      route.execution === undefined ||
      route.execution === null;
    if (usesLlm) {
      if (!route.models?.low || !route.models?.medium || !route.models?.high) {
        throw new Error(`route "${route.id}" must define low, medium, and high models`);
      }
      if (!route.llm?.baseURL) {
        throw new Error(`route "${route.id}" requires llm.baseURL`);
      }
    }
    if (route.windows.length === 0) {
      throw new Error(`route "${route.id}" must define at least one quota window`);
    }
  }
}

export function defaultRouteWindows(
  baseURL: string,
  executor?: ExecutorConfig,
): QuotaWindowConfig[] {
  return defaultWindowsForPrimary(baseURL, executor);
}
