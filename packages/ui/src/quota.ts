import type {
  QuotaAccountState,
  QuotaSnapshot,
  QuotaWindowState,
} from './api/types';

export function formatUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'soon';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `in ${hr}h ${remMin}m` : `in ${hr}h`;
  const days = Math.floor(hr / 24);
  return `in ${days}d`;
}

export function windowUsed(
  window: QuotaWindowState,
  workstreamId?: string,
): number {
  if (window.config.scope === 'workstream' && workstreamId) {
    return window.usedByWorkstream[workstreamId] ?? 0;
  }
  return window.used;
}

export function windowPercent(
  window: QuotaWindowState,
  workstreamId?: string,
): number {
  const used = windowUsed(window, workstreamId);
  if (window.config.limit <= 0) return 100;
  return Math.min(100, (used / window.config.limit) * 100);
}

export function formatQuotaUnit(
  unit: QuotaWindowState['config']['unit'],
  value: number,
): string {
  if (unit === 'dollars') {
    if (value < 0.01) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
  }
  if (unit === 'requests') return `${Math.round(value)} req`;
  return value.toLocaleString();
}

export function windowLabel(window: QuotaWindowState): string {
  const { id, period, scope } = window.config;
  const periodLabel = period.replace('rolling5h', '5h rolling');
  return scope === 'workstream'
    ? `${id} (${periodLabel}, per workstream)`
    : `${id} (${periodLabel})`;
}

export function accountStatusColor(
  status: QuotaAccountState['status'],
): 'green' | 'yellow' | 'red' | 'gray' {
  switch (status) {
    case 'ok':
      return 'green';
    case 'warning':
      return 'yellow';
    case 'exhausted':
      return 'red';
    default:
      return 'gray';
  }
}

export function quotaHeadline(
  snapshot: QuotaSnapshot | null | undefined,
): string | null {
  if (!snapshot) return null;
  const accounts = Object.values(snapshot.accounts);
  if (accounts.length === 0) return null;

  const exhausted = accounts.filter((a) => a.status === 'exhausted');
  if (exhausted.length > 0) {
    const resetsAt = earliestReset(exhausted);
    return resetsAt
      ? `Quota exhausted — resumes ${formatUntil(resetsAt)}`
      : 'Quota exhausted — work paused';
  }

  const failover = Object.entries(snapshot.activeRoutes).filter(
    ([, route]) => route !== 'primary',
  );
  if (failover.length > 0) {
    return `Failover active (${failover.map(([, r]) => r).join(', ')})`;
  }

  const warning = accounts.filter((a) => a.status === 'warning');
  if (warning.length > 0) {
    return `Quota warning on ${warning.map((a) => a.config.id).join(', ')}`;
  }

  return null;
}

function earliestReset(accounts: QuotaAccountState[]): string | undefined {
  let earliest: number | undefined;
  for (const account of accounts) {
    for (const window of account.windows) {
      if (!window.resetsAt) continue;
      const t = new Date(window.resetsAt).getTime();
      if (Number.isNaN(t)) continue;
      if (earliest === undefined || t < earliest) earliest = t;
    }
  }
  return earliest !== undefined ? new Date(earliest).toISOString() : undefined;
}

export function earliestQuotaReset(
  snapshot: QuotaSnapshot | null | undefined,
): string | undefined {
  if (!snapshot) return undefined;
  return earliestReset(Object.values(snapshot.accounts));
}
