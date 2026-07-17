import type { RuntimeConfig } from '../config.js';
import type { ExecutionRouteConfig, QuotaConfig } from './quota-types.js';
import type { ModelTier, ModelTiers } from './models.js';
import {
  cloneRoleTiers,
  getPreset,
  isPresetId,
  listPresets,
} from './presets.js';
import {
  normalizeQuotaConfig,
  stripDerivedQuotaFields,
  validateRoutes,
} from './route-config.js';
import type { RoleName } from '../storage/types.js';
import type { QuotaLedger } from './quota-ledger.js';

export interface ProviderConfigUpdate {
  applyPreset?: string;
  reservePercent?: number;
  /** Updates the primary route's daily-budget window limit (dollars). */
  dailyBudgetLimit?: number;
  /** Replaces the full ordered execution route chain. Call get_provider_config first. */
  routes?: ExecutionRouteConfig[];
}

export interface ProviderConfigSnapshot {
  modelPresetId: string;
  models: ModelTiers;
  roleTiers: Record<RoleName, ModelTier>;
  baseURL: string;
  executor?: RuntimeConfig['executor'];
  availablePresets: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  quota: {
    configured: Pick<QuotaConfig, 'reservePercent' | 'routes'> | null;
    effective: Pick<QuotaConfig, 'reservePercent' | 'routes'> | null;
  };
  quotaUsage: ReturnType<QuotaLedger['snapshot']> | null;
}

function syncPresetToPrimaryRoute(
  config: RuntimeConfig,
  presetId: string,
): void {
  const preset = getPreset(presetId);
  const primary = config.quota?.routes?.[0];
  if (!preset || !primary) return;
  const restRoutes = config.quota?.routes?.slice(1) ?? [];
  config.quota = {
    ...config.quota,
    routes: [
      {
        ...primary,
        presetId,
        models: { ...preset.tiers },
        roleTiers: cloneRoleTiers(preset.roleTiers),
      },
      ...restRoutes,
    ],
  };
}

export function buildProviderConfigSnapshot(
  config: RuntimeConfig,
  quotaUsage: ReturnType<QuotaLedger['snapshot']> | undefined,
): ProviderConfigSnapshot {
  const effective = normalizeQuotaConfig(config.quota, config);
  const configured = config.quota?.routes?.length
    ? stripDerivedQuotaFields(normalizeQuotaConfig(config.quota, config))
    : null;

  return {
    modelPresetId: config.modelPresetId,
    models: { ...config.models },
    roleTiers: { ...config.roleTiers },
    baseURL: config.baseURL,
    executor: config.executor,
    availablePresets: listPresets().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    })),
    quota: {
      configured,
      effective: stripDerivedQuotaFields(effective),
    },
    quotaUsage: quotaUsage ?? null,
  };
}

export function applyProviderConfigUpdate(
  config: RuntimeConfig,
  update: ProviderConfigUpdate,
): string[] {
  const changes: string[] = [];

  if (update.applyPreset !== undefined) {
    if (!isPresetId(update.applyPreset)) {
      throw new Error(`Unknown model preset: ${update.applyPreset}`);
    }
    const preset = getPreset(update.applyPreset)!;
    config.models = { ...preset.tiers };
    config.model = preset.tiers.medium;
    config.roleTiers = cloneRoleTiers(preset.roleTiers);
    config.modelPresetId = preset.id;
    syncPresetToPrimaryRoute(config, preset.id);
    changes.push(`applied preset "${preset.name}" (${preset.id})`);
  }

  let quotaDirty = false;
  const quota: QuotaConfig = config.quota?.routes?.length
    ? { ...stripDerivedQuotaFields(normalizeQuotaConfig(config.quota, config)) }
    : {
        reservePercent: 10,
        routes: normalizeQuotaConfig(undefined, config).routes!,
      };

  if (update.reservePercent !== undefined) {
    quota.reservePercent = update.reservePercent;
    quotaDirty = true;
    changes.push(`reservePercent → ${update.reservePercent}%`);
  }

  if (update.dailyBudgetLimit !== undefined) {
    if (update.dailyBudgetLimit <= 0) {
      throw new Error('dailyBudgetLimit must be positive');
    }
    const routes = [...(quota.routes ?? [])];
    if (routes.length === 0) {
      throw new Error('no routes configured');
    }
    const primary = { ...routes[0]! };
    const windows = primary.windows.map((w) =>
      w.id === 'daily-budget' ? { ...w, limit: update.dailyBudgetLimit! } : w,
    );
    const hasDaily = primary.windows.some((w) => w.id === 'daily-budget');
    primary.windows = hasDaily
      ? windows
      : [
          ...primary.windows,
          {
            id: 'daily-budget',
            unit: 'dollars' as const,
            period: 'daily' as const,
            scope: 'global' as const,
            limit: update.dailyBudgetLimit,
            warnAtPercent: 70,
            blockAtPercent: 90,
          },
        ];
    routes[0] = primary;
    quota.routes = routes;
    quotaDirty = true;
    changes.push(`primary daily budget → $${update.dailyBudgetLimit}`);
  }

  if (update.routes !== undefined) {
    validateRoutes(update.routes);
    quota.routes = update.routes;
    quotaDirty = true;
    changes.push(`route chain updated (${update.routes.length} route(s))`);
  }

  if (quotaDirty) {
    config.quota = quota;
  }

  if (changes.length === 0) {
    throw new Error('no configuration changes provided');
  }

  return changes;
}
