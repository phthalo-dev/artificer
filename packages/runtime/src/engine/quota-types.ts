import type { ExecutorConfig } from '../api/types.js';
import type { ModelTier, ModelTiers } from './models.js';
import type { RoleName } from '../storage/types.js';

export type BillingMode = 'metered' | 'windowed' | 'opaque';
export type QuotaUnit = 'dollars' | 'tokens' | 'requests';
export type QuotaPeriod =
  | 'rolling5h'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'fixed';
export type QuotaScope = 'global' | 'workstream';
export type OnExhaustedPolicy = 'wait' | 'failover';
export type QuotaAccountStatus = 'ok' | 'warning' | 'exhausted' | 'unknown';
export type QuotaUsageSource =
  | 'metered'
  | 'provider'
  | 'estimated'
  | 'inferred';

export interface QuotaWindowConfig {
  id: string;
  unit: QuotaUnit;
  period: QuotaPeriod;
  scope?: QuotaScope;
  limit: number;
  warnAtPercent?: number;
  blockAtPercent?: number;
}

export interface FailoverLlmConfig {
  baseURL: string;
  apiKeyEnv?: string;
  models?: Partial<ModelTiers>;
  preset?: string;
}

export interface FailoverTargetConfig {
  id: string;
  accountId: string;
  roles?: string[];
  llm?: FailoverLlmConfig;
  executor?: ExecutorConfig | 'llm';
  onExhausted?: OnExhaustedPolicy;
}

/** Ordered execution + quota configuration (failover = next route in array). */
export interface ExecutionRouteConfig {
  id: string;
  accountId: string;
  mode: BillingMode;
  windows: QuotaWindowConfig[];
  execution: ExecutorConfig | 'llm';
  llm?: {
    baseURL: string;
    apiKeyEnv?: string;
  };
  presetId?: string;
  models: ModelTiers;
  roleTiers?: Record<RoleName, ModelTier>;
  roles?: string[];
  pollIntervalMs?: number;
  unitWeights?: Partial<Record<string, number>>;
}

export interface QuotaAccountConfig {
  id: string;
  mode: BillingMode;
  windows: QuotaWindowConfig[];
  onExhausted?: OnExhaustedPolicy;
  failover?: FailoverTargetConfig[];
  pollIntervalMs?: number;
  unitWeights?: Partial<Record<string, number>>;
}

export interface QuotaConfig {
  reservePercent?: number;
  defaultEstimateDollars?: Partial<Record<ModelTier, number>>;
  /** Ordered failover chain — first route is primary. */
  routes?: ExecutionRouteConfig[];
  /** @deprecated Derived from routes at runtime; legacy configs only. */
  accounts?: QuotaAccountConfig[];
}

/** Rolling-window increment for trailing-period accounting. */
export interface RollingEntry {
  amount: number;
  at: string;
}

/** Persisted runtime state for one quota window. */
export interface QuotaWindowState {
  config: QuotaWindowConfig;
  used: number;
  usedByWorkstream: Record<string, number>;
  rollingEntries: RollingEntry[];
  windowStart?: string;
  resetsAt?: string;
  source: QuotaUsageSource;
}

export interface QuotaAccountState {
  config: QuotaAccountConfig;
  windows: QuotaWindowState[];
  status: QuotaAccountStatus;
  updatedAt: string;
}

export interface QuotaPersistedState {
  accounts: Record<string, QuotaAccountState>;
  activeRoutes: Record<string, string>;
  pausedWorkstreams: Record<string, string>;
}

export interface DispatchRoute {
  profileId: string;
  accountId: string;
  baseURL: string;
  apiKey: string;
  models: ModelTiers;
  roleTiers: Record<RoleName, ModelTier>;
  /** When set, work roles use this executor; otherwise internal LLM loop. */
  executorName?: string;
  useLlmForWorkRoles: boolean;
}
