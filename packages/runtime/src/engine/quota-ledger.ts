import fs from 'node:fs';
import path from 'node:path';
import type { ModelTier } from './models.js';
import { costForUsage } from './pricing.js';
import type { RunRecord } from '../storage/types.js';
import {
  type QuotaAccountConfig,
  type QuotaAccountState,
  type QuotaConfig,
  type QuotaPersistedState,
  type QuotaWindowConfig,
  type QuotaWindowState,
  type RollingEntry,
} from './quota-types.js';

const ROLLING5H_MS = 5 * 60 * 60 * 1000;
const DEFAULT_UNIT_WEIGHTS: Record<string, number> = {
  planner: 1.5,
  worker: 1,
  reviewer: 0.5,
};

function defaultWindowState(config: QuotaWindowConfig): QuotaWindowState {
  const source =
    config.unit === 'requests' ? 'inferred' : ('metered' as const);
  return {
    config: {
      ...config,
      scope: config.scope ?? 'global',
      warnAtPercent: config.warnAtPercent ?? 70,
      blockAtPercent: config.blockAtPercent ?? 90,
    },
    used: 0,
    usedByWorkstream: {},
    rollingEntries: [],
    windowStart: config.period === 'fixed' ? new Date().toISOString() : undefined,
    source,
  };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcWeek(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function nextPeriodStart(period: QuotaWindowConfig['period'], from: Date): Date {
  switch (period) {
    case 'daily': {
      const next = startOfUtcDay(from);
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    }
    case 'weekly': {
      const next = startOfUtcWeek(from);
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    }
    case 'monthly': {
      const next = startOfUtcMonth(from);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    }
    case 'rolling5h':
      return new Date(from.getTime() + ROLLING5H_MS);
    default:
      return from;
  }
}

function usedForScope(
  window: QuotaWindowState,
  workstreamId?: string,
): number {
  if (window.config.scope === 'workstream' && workstreamId) {
    return window.usedByWorkstream[workstreamId] ?? 0;
  }
  if (window.config.period === 'rolling5h') {
    return sumRolling(window.rollingEntries);
  }
  return window.used;
}

function sumRolling(entries: RollingEntry[]): number {
  const cutoff = Date.now() - ROLLING5H_MS;
  return entries
    .filter((e) => new Date(e.at).getTime() > cutoff)
    .reduce((sum, e) => sum + e.amount, 0);
}

function pruneRolling(entries: RollingEntry[]): RollingEntry[] {
  const cutoff = Date.now() - ROLLING5H_MS;
  return entries.filter((e) => new Date(e.at).getTime() > cutoff);
}

function percentUsed(window: QuotaWindowState, workstreamId?: string): number {
  const used = usedForScope(window, workstreamId);
  if (window.config.limit <= 0) return 100;
  return (used / window.config.limit) * 100;
}

function effectiveLimit(limit: number, blockAtPercent: number): number {
  return (limit * blockAtPercent) / 100;
}

export class QuotaLedger {
  private state: QuotaPersistedState;
  private readonly config: QuotaConfig;

  constructor(
    config: QuotaConfig,
    private readonly statePath: string,
    persisted?: QuotaPersistedState,
  ) {
    this.config = config;
    this.state = persisted ?? { accounts: {}, activeRoutes: {}, pausedWorkstreams: {} };
    this.ensureAccounts(config.accounts ?? []);
    this.refreshAllStatuses();
  }

  static load(config: QuotaConfig, statePath: string): QuotaLedger {
    let persisted: QuotaPersistedState | undefined;
    try {
      if (fs.existsSync(statePath)) {
        persisted = JSON.parse(
          fs.readFileSync(statePath, 'utf-8'),
        ) as QuotaPersistedState;
      }
    } catch {
      persisted = undefined;
    }
    const ledger = new QuotaLedger(config, statePath, persisted);
    ledger.tick();
    return ledger;
  }

  getConfig(): QuotaConfig {
    return this.config;
  }

  getAccountConfig(id: string): QuotaAccountConfig | undefined {
    return this.state.accounts[id]?.config;
  }

  getActiveRoute(accountId: string): string {
    return this.state.activeRoutes[accountId] ?? 'primary';
  }

  setActiveRoute(accountId: string, profileId: string): void {
    this.state.activeRoutes[accountId] = profileId;
    void this.persist();
  }

  clearActiveRoute(accountId: string): void {
    delete this.state.activeRoutes[accountId];
    void this.persist();
  }

  getPausedWorkstreams(): Record<string, string> {
    return { ...this.state.pausedWorkstreams };
  }

  recordPausedWorkstream(workstreamId: string, priorStatus: string): void {
    this.state.pausedWorkstreams[workstreamId] = priorStatus;
    void this.persist();
  }

  clearPausedWorkstream(workstreamId: string): void {
    delete this.state.pausedWorkstreams[workstreamId];
    void this.persist();
  }

  estimateNextRun(
    tier: ModelTier,
    role?: string,
    accountId?: string,
  ): number {
    const account = accountId
      ? this.state.accounts[accountId]
      : undefined;
    if (account?.config.mode === 'opaque' && role) {
      const weights = account.config.unitWeights ?? DEFAULT_UNIT_WEIGHTS;
      return weights[role] ?? 1;
    }
    return this.config.defaultEstimateDollars?.[tier] ?? 0.15;
  }

  canDispatch(
    accountId: string,
    estimate: number,
    role: string,
    workstreamId?: string,
    options?: { useReserve?: boolean },
  ): boolean {
    const account = this.state.accounts[accountId];
    if (!account) return true;

    const reserve = options?.useReserve ? 0 : (this.config.reservePercent ?? 0);
    const isCommunicator = role === 'communicator';

    for (const window of account.windows) {
      const used = usedForScope(window, workstreamId);
      const blockAt = window.config.blockAtPercent ?? 90;
      let limit = effectiveLimit(window.config.limit, blockAt);
      if (!isCommunicator && reserve > 0) {
        limit = window.config.limit * (1 - reserve / 100) * (blockAt / 100);
      } else if (isCommunicator && reserve > 0) {
        limit = window.config.limit * (blockAt / 100);
      }
      if (used + estimate > limit + 1e-9) return false;
    }
    return true;
  }

  isAccountExhausted(accountId: string, workstreamId?: string): boolean {
    const account = this.state.accounts[accountId];
    if (!account) return false;
    return account.windows.some(
      (w) => percentUsed(w, workstreamId) >= (w.config.blockAtPercent ?? 90),
    );
  }

  recordLlmRun(
    accountId: string,
    run: RunRecord,
    source: 'metered' | 'estimated',
  ): void {
    const account = this.state.accounts[accountId];
    if (!account) return;
    const dollars = costForUsage(run.model, run.usage);
    this.addUsage(accountId, dollars, run.workstreamId, source);
  }

  recordExecutorInvocation(
    accountId: string,
    role: string,
    workstreamId?: string,
  ): void {
    const account = this.state.accounts[accountId];
    if (!account) return;
    const weights = account.config.unitWeights ?? DEFAULT_UNIT_WEIGHTS;
    const units = weights[role] ?? 1;
    this.addUsage(accountId, units, workstreamId, 'inferred');
  }

  markAccountExhausted(accountId: string, resetsAt?: string): void {
    const account = this.state.accounts[accountId];
    if (!account) return;
    const now = new Date().toISOString();
    for (const window of account.windows) {
      if (resetsAt) window.resetsAt = resetsAt;
      if (window.config.period === 'rolling5h') {
        window.rollingEntries = [{ amount: window.config.limit, at: now }];
        window.used = sumRolling(window.rollingEntries);
      } else if (
        window.config.scope === 'workstream' &&
        window.config.period === 'fixed'
      ) {
        // caller may pass workstream via separate API later
        window.used = window.config.limit;
      } else {
        window.used = window.config.limit;
      }
    }
    account.status = 'exhausted';
    account.updatedAt = now;
    void this.persist();
  }

  addUsage(
    accountId: string,
    amount: number,
    workstreamId: string | undefined,
    source: QuotaWindowState['source'],
  ): void {
    const account = this.state.accounts[accountId];
    if (!account) return;
    const now = new Date().toISOString();
    for (const window of account.windows) {
      window.source = source;
      if (window.config.scope === 'workstream' && workstreamId) {
        window.usedByWorkstream[workstreamId] =
          (window.usedByWorkstream[workstreamId] ?? 0) + amount;
      } else if (window.config.period === 'rolling5h') {
        window.rollingEntries.push({ amount, at: now });
        window.rollingEntries = pruneRolling(window.rollingEntries);
        window.used = sumRolling(window.rollingEntries);
      } else {
        window.used += amount;
      }
    }
    this.refreshAccountStatus(accountId);
    void this.persist();
  }

  resetWindow(
    accountId: string,
    windowId: string,
    workstreamId?: string,
  ): boolean {
    const account = this.state.accounts[accountId];
    if (!account) return false;
    const window = account.windows.find((w) => w.config.id === windowId);
    if (!window) return false;
    if (window.config.scope === 'workstream' && workstreamId) {
      delete window.usedByWorkstream[workstreamId];
    } else {
      window.used = 0;
      window.rollingEntries = [];
      window.windowStart = new Date().toISOString();
    }
    this.refreshAccountStatus(accountId);
    void this.persist();
    return true;
  }

  /** Advance calendar windows, prune rolling entries, refresh statuses. */
  tick(now = new Date()): string | undefined {
    for (const [accountId, account] of Object.entries(this.state.accounts)) {
      for (const window of account.windows) {
        this.maybeRolloverWindow(window, now);
      }
      this.refreshAccountStatus(accountId);
    }
    void this.persist();
    return this.nextReset();
  }

  nextReset(): string | undefined {
    let earliest: number | undefined;
    for (const account of Object.values(this.state.accounts)) {
      for (const window of account.windows) {
        if (!window.resetsAt) continue;
        const t = new Date(window.resetsAt).getTime();
        if (Number.isNaN(t)) continue;
        if (earliest === undefined || t < earliest) earliest = t;
      }
    }
    return earliest !== undefined ? new Date(earliest).toISOString() : undefined;
  }

  nextResetMs(): number | undefined {
    const iso = this.nextReset();
    if (!iso) return undefined;
    return Math.max(0, new Date(iso).getTime() - Date.now());
  }

  snapshot(): QuotaPersistedState & { reservePercent: number } {
    return {
      ...this.state,
      reservePercent: this.config.reservePercent ?? 10,
    };
  }

  private ensureAccounts(configs: QuotaAccountConfig[]): void {
    for (const config of configs) {
      if (this.state.accounts[config.id]) {
        this.state.accounts[config.id].config = config;
        const existingIds = new Set(
          this.state.accounts[config.id].windows.map((w) => w.config.id),
        );
        for (const windowConfig of config.windows) {
          if (!existingIds.has(windowConfig.id)) {
            this.state.accounts[config.id].windows.push(
              defaultWindowState(windowConfig),
            );
          } else {
            const w = this.state.accounts[config.id].windows.find(
              (x) => x.config.id === windowConfig.id,
            );
            if (w) w.config = { ...w.config, ...windowConfig, scope: windowConfig.scope ?? w.config.scope };
          }
        }
        continue;
      }
      this.state.accounts[config.id] = {
        config,
        windows: config.windows.map(defaultWindowState),
        status: 'ok',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  private maybeRolloverWindow(window: QuotaWindowState, now: Date): void {
    const { period } = window.config;
    if (period === 'fixed' || period === 'rolling5h') {
      if (period === 'rolling5h') {
        window.rollingEntries = pruneRolling(window.rollingEntries);
        window.used = sumRolling(window.rollingEntries);
        if (window.rollingEntries.length > 0) {
          const oldest = window.rollingEntries.reduce((min, e) =>
            new Date(e.at) < new Date(min.at) ? e : min,
          );
          window.resetsAt = new Date(
            new Date(oldest.at).getTime() + ROLLING5H_MS,
          ).toISOString();
        } else {
          window.resetsAt = undefined;
        }
      }
      return;
    }

    const periodStart = this.periodStart(period, now);
    const startIso = periodStart.toISOString();
    if (window.windowStart === startIso) return;

    window.windowStart = startIso;
    window.used = 0;
    window.usedByWorkstream = {};
    window.resetsAt = nextPeriodStart(period, now).toISOString();
  }

  private periodStart(period: QuotaWindowConfig['period'], now: Date): Date {
    switch (period) {
      case 'daily':
        return startOfUtcDay(now);
      case 'weekly':
        return startOfUtcWeek(now);
      case 'monthly':
        return startOfUtcMonth(now);
      default:
        return now;
    }
  }

  private refreshAllStatuses(): void {
    for (const id of Object.keys(this.state.accounts)) {
      this.refreshAccountStatus(id);
    }
  }

  private refreshAccountStatus(accountId: string): void {
    const account = this.state.accounts[accountId];
    if (!account) return;
    let status: QuotaAccountState['status'] = 'ok';
    for (const window of account.windows) {
      const pct = percentUsed(window);
      if (pct >= (window.config.blockAtPercent ?? 90)) {
        status = 'exhausted';
        break;
      }
      if (pct >= (window.config.warnAtPercent ?? 70)) {
        status = 'warning';
      }
    }
    account.status = status;
    account.updatedAt = new Date().toISOString();

    if (status !== 'exhausted') {
      for (const window of account.windows) {
        if (window.config.period !== 'fixed') {
          const now = new Date();
          window.resetsAt = nextPeriodStart(window.config.period, now).toISOString();
        }
      }
    }
  }

  private async persist(): Promise<void> {
    if (this.statePath === ':memory:') return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }
}
