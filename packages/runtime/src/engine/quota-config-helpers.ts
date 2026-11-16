import { resolveAcpLaunch } from './acp-presets.js';
import type { ExecutorConfig } from '../api/types.js';
import type { QuotaAccountConfig, QuotaWindowConfig } from './quota-types.js';

const GO_WINDOWS: QuotaWindowConfig[] = [
  {
    id: 'rolling5h',
    unit: 'dollars',
    period: 'rolling5h',
    scope: 'global',
    limit: 12,
    warnAtPercent: 70,
    blockAtPercent: 90,
  },
  {
    id: 'weekly',
    unit: 'dollars',
    period: 'weekly',
    scope: 'global',
    limit: 30,
    warnAtPercent: 70,
    blockAtPercent: 90,
  },
  {
    id: 'monthly',
    unit: 'dollars',
    period: 'monthly',
    scope: 'global',
    limit: 60,
    warnAtPercent: 80,
    blockAtPercent: 95,
  },
];

function isGoUrl(baseURL: string): boolean {
  return baseURL.replace(/\/$/, '').endsWith('/zen/go/v1');
}

function isZenUrl(baseURL: string): boolean {
  const normalized = baseURL.replace(/\/$/, '');
  return (
    normalized.endsWith('/zen/v1') || normalized.includes('opencode.ai/zen/v1')
  );
}

export function executorAccountId(
  executor?: ExecutorConfig,
): string | undefined {
  if (!executor || executor === 'llm') return undefined;
  if (executor === 'cursor-agent') return 'cursor-agent';
  if (executor === 'claude-code') return 'claude-code';
  if (executor === 'opencode') return 'opencode';
  if (executor.type === 'cursor-agent') return 'cursor-agent';
  if (executor.type === 'claude-code') return 'claude-code';
  if (executor.type === 'opencode') return 'opencode';
  if (executor.type === 'acp') return resolveAcpLaunch(executor).name;
  return undefined;
}

export function primaryAccountId(
  baseURL: string,
  executor?: ExecutorConfig,
): string {
  const execId = executorAccountId(executor);
  if (execId) return execId;
  if (isGoUrl(baseURL)) return 'opencode-go';
  if (isZenUrl(baseURL)) return 'opencode-zen';
  if (baseURL.includes('anthropic.com')) return 'anthropic';
  return 'primary-llm';
}

export function primaryAccountIdFor(
  runtime: Pick<
    { baseURL: string; executor?: ExecutorConfig },
    'baseURL' | 'executor'
  >,
): string {
  return primaryAccountId(runtime.baseURL, runtime.executor);
}

export function defaultWindowsForPrimary(
  baseURL: string,
  executor?: ExecutorConfig,
): QuotaWindowConfig[] {
  if (isGoUrl(baseURL)) return GO_WINDOWS;
  const execId = executorAccountId(executor);
  if (execId === 'cursor-agent' || execId === 'claude-code') {
    return [
      {
        id: 'weekly-requests',
        unit: 'requests',
        period: 'weekly',
        scope: 'global',
        limit: 200,
        warnAtPercent: 70,
        blockAtPercent: 90,
      },
    ];
  }
  return [];
}

export function defaultMode(
  baseURL: string,
  executor?: ExecutorConfig,
): QuotaAccountConfig['mode'] {
  if (isGoUrl(baseURL)) return 'windowed';
  if (executorAccountId(executor)) return 'opaque';
  return 'metered';
}
