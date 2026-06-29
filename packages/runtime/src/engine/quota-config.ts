import type { RuntimeConfig } from '../config.js';
import type { ExecutorConfig } from '../api/types.js';
import type { ModelTier } from './models.js';
import { getPreset } from './presets.js';
import {
  defaultMode,
  defaultWindowsForPrimary,
  executorAccountId,
  primaryAccountId,
} from './quota-config-helpers.js';
import {
  accountsFromRoutes,
  normalizeQuotaConfig,
  validateRoutes,
} from './route-config.js';
import type {
  OnExhaustedPolicy,
  QuotaAccountConfig,
  QuotaConfig,
  QuotaWindowConfig,
} from './quota-types.js';

function applyEnvOverrides(
  config: QuotaConfig,
  env: NodeJS.ProcessEnv,
  primaryId: string,
): QuotaConfig {
  const reservePercent = env.QUOTA_RESERVE_PERCENT
    ? Number(env.QUOTA_RESERVE_PERCENT)
    : config.reservePercent;

  let accounts = [...(config.accounts ?? [])];
  const dailyBudget = env.QUOTA_DAILY_BUDGET_USD
    ? Number(env.QUOTA_DAILY_BUDGET_USD)
    : undefined;

  if (dailyBudget && !accounts.some((a) => a.id === 'opencode-zen' || a.id === primaryId)) {
    accounts.push({
      id: primaryId,
      mode: 'metered',
      windows: [
        {
          id: 'daily-budget',
          unit: 'dollars',
          period: 'daily',
          scope: 'global',
          limit: dailyBudget,
          warnAtPercent: 70,
          blockAtPercent: 90,
        },
      ],
    });
  } else if (dailyBudget) {
    accounts = accounts.map((account) => {
      if (account.id !== primaryId && account.id !== 'opencode-zen') return account;
      const hasDaily = account.windows.some(
        (w: QuotaWindowConfig) => w.id === 'daily-budget',
      );
      if (hasDaily) return account;
      return {
        ...account,
        windows: [
          ...account.windows,
          {
            id: 'daily-budget',
            unit: 'dollars',
            period: 'daily',
            scope: 'global',
            limit: dailyBudget,
            warnAtPercent: 70,
            blockAtPercent: 90,
          },
        ],
      };
    });
  }

  const onExhaustedEnv = env.QUOTA_ON_EXHAUSTED;
  const onExhausted: OnExhaustedPolicy | undefined =
    onExhaustedEnv === 'wait' || onExhaustedEnv === 'failover'
      ? onExhaustedEnv
      : undefined;

  if (onExhausted) {
    accounts = accounts.map((account, index) =>
      index === 0 || account.id === primaryId
        ? { ...account, onExhausted }
        : account,
    );
  }

  return {
    ...config,
    reservePercent: reservePercent ?? config.reservePercent,
    accounts,
  };
}

/** Validate route chain and legacy failover references. */
export function validateQuotaConfig(config: QuotaConfig): void {
  if (config.routes?.length) {
    validateRoutes(config.routes);
    return;
  }
  const ids = new Set(config.accounts?.map((a) => a.id) ?? []);
  for (const account of config.accounts ?? []) {
    for (const target of account.failover ?? []) {
      if (!ids.has(target.accountId)) {
        throw new Error(
          `quota account "${account.id}" failover references unknown account "${target.accountId}"`,
        );
      }
    }
  }
}

export function buildQuotaConfig(
  runtime: Pick<
    RuntimeConfig,
    'baseURL' | 'executor' | 'quota' | 'models' | 'roleTiers' | 'modelPresetId'
  >,
  env: NodeJS.ProcessEnv = process.env,
): QuotaConfig | undefined {
  const primaryId = primaryAccountId(runtime.baseURL, runtime.executor);

  let normalized = normalizeQuotaConfig(runtime.quota, runtime);
  const hasExplicit =
    (runtime.quota?.routes?.length ?? 0) > 0 ||
    (runtime.quota?.accounts?.length ?? 0) > 0;
  if (!hasExplicit) {
    const windows = normalized.routes?.[0]?.windows ?? [];
    if (windows.length === 0 && !env.QUOTA_DAILY_BUDGET_USD) return undefined;
  }

  const defaultEstimates: Partial<Record<ModelTier, number>> = {
    low: 0.02,
    medium: 0.15,
    high: 0.5,
    ...(runtime.quota?.defaultEstimateDollars ?? {}),
  };

  const config: QuotaConfig = applyEnvOverrides(
    {
      ...normalized,
      defaultEstimateDollars: defaultEstimates,
      accounts: accountsFromRoutes(normalized.routes ?? []),
    },
    env,
    primaryId,
  );

  validateQuotaConfig(config);
  return config;
}

export function resolveFailoverApiKey(
  env: NodeJS.ProcessEnv,
  apiKeyEnv?: string,
): string {
  const keyName = apiKeyEnv ?? 'LLM_API_KEY';
  return (
    env[keyName] ??
    env.LLM_API_KEY ??
    env.ZEN_API_KEY ??
    env.ANTHROPIC_API_KEY ??
    ''
  );
}

export function modelsFromFailoverPreset(
  presetId: string,
): import('./models.js').ModelTiers | undefined {
  return getPreset(presetId)?.tiers;
}

export function primaryAccountIdFor(runtime: Pick<RuntimeConfig, 'baseURL' | 'executor'>): string {
  return primaryAccountId(runtime.baseURL, runtime.executor);
}
