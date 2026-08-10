import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import type { RuntimeConfig } from '../config.js';
import { scanAgentDirectory } from '../discover/discover.js';
import { loadSchedulesFromDisk } from '../discover/loader.js';
import {
  isSafeScheduleId,
  serializeSchedule,
  validateScheduleFields,
  type ScheduleAction,
  type ScheduleDefinition,
} from './schedules.js';
import { IdentityGitSync } from '../storage/identity-git-sync.js';

const exec = promisify(execFile);
import type { EngineApi, RuntimeEvent, SpawnCallInput } from '../context.js';
import { resolveLanguageModel } from '../llm/provider.js';
import { Store } from '../storage/store.js';
import type { IdentityStore } from '../storage/identity-store.js';
import type {
  Message,
  RunRecord,
  Workstream,
  WorkstreamStatus,
} from '../storage/types.js';
import { executeCall } from './call.js';
import type { WorkerExecutor } from './executor.js';
import type { ScheduleRunner } from './schedule-runner.js';
import { CursorAgentExecutor } from './cursor-executor.js';
import { ClaudeCodeExecutor } from './claude-code-executor.js';
import { CliExecutor } from './cli-executor.js';
import { findGitRepo } from './git-repo.js';
import { cloneRepoIntoWorkspace, hasUncommittedChanges } from './git-ops.js';
import {
  nextWorkstreamAction,
  type WorkstreamFacts,
} from './workstream-machine.js';
import { workerRunDone, workerRunSummary } from './worker-report.js';
import { countNoProgressRepeats } from './worker-progress.js';
import { buildPriorWorkContext } from './prior-work-context.js';
import { buildGitEnv } from '../tools/git-env.js';
import {
  insufficientBalanceUserMessage,
  isInsufficientBalanceError,
  isQuotaExhaustedError,
  quotaPausedUserMessage,
  quotaRetryAfterMs,
} from '../llm/errors.js';
import { type ModelTier, type ModelTiers, pickModel } from './models.js';
import { cloneRoleTiers, getPreset, type ModelPreset } from './presets.js';
import { Scheduler } from './scheduler.js';
import { WorkstreamMemoryService } from './workstream-memory.js';
import { RoleRegistry } from './role-registry.js';
import { buildQuotaConfig, validateQuotaConfig } from './quota-config.js';
import {
  applyProviderConfigUpdate,
  buildProviderConfigSnapshot,
  type ProviderConfigSnapshot,
  type ProviderConfigUpdate,
} from './provider-config.js';
import {
  normalizeQuotaConfig,
  stripDerivedQuotaFields,
  syncPrimaryRouteToRuntime,
} from './route-config.js';
import type { QuotaConfig } from './quota-types.js';
import { QuotaLedger } from './quota-ledger.js';
import {
  executorForRoute,
  ProviderRouter,
  type ResolveRouteInput,
} from './provider-router.js';
import type { DispatchRoute } from './quota-types.js';
import type { RoleName } from '../storage/types.js';

interface ActiveRun {
  runId: string;
  role: string;
  workstreamId?: string;
  startedAt: string;
}

export interface RuntimeState {
  agentName: string;
  busy: boolean;
  queue: { pending: number; running: number };
  activeRuns: ActiveRun[];
  workstreams: Array<
    Pick<Workstream, 'id' | 'title' | 'status' | 'summary' | 'updatedAt'>
  >;
}

/**
 * The runtime engine. It receives messages like a person would, runs the
 * hierarchical orchestration of small LLM calls, and persists everything to
 * disk. It implements EngineApi so tools can spawn calls and reply.
 */
export class Engine implements EngineApi {
  readonly store: Store;
  readonly identity?: IdentityStore;
  readonly config: RuntimeConfig;
  private readonly scheduler: Scheduler;
  private readonly events = new EventEmitter();
  private readonly active = new Map<string, ActiveRun>();
  private readonly memoryService?: WorkstreamMemoryService;
  private readonly executor?: WorkerExecutor;
  private readonly registry: RoleRegistry;
  private scheduleRunner?: ScheduleRunner;
  private quotaLedger?: QuotaLedger;
  private providerRouter?: ProviderRouter;
  private readonly runRoutes = new Map<string, DispatchRoute>();
  private quotaResumeTimer?: ReturnType<typeof setTimeout>;
  /** Avoid spamming the user when many concurrent calls hit the same billing wall. */
  private readonly balanceNotified = new Set<string>();
  private readonly quotaNotified = new Set<string>();

  constructor(
    config: RuntimeConfig,
    store: Store,
    memoryService?: WorkstreamMemoryService,
    registry?: RoleRegistry,
    identity?: IdentityStore,
  ) {
    this.config = config;
    this.store = store;
    this.identity = identity;
    this.memoryService = memoryService;
    this.registry = registry ?? new RoleRegistry();
    this.executor = buildExecutor(config.executor);
    this.reinitializeQuota();
    if (this.quotaLedger) {
      this.scheduleQuotaTick();
    }
    this.scheduler = new Scheduler(config.concurrency, (runId) =>
      this.runOne(runId),
    );
  }

  getQuotaSnapshot(): ReturnType<QuotaLedger['snapshot']> | undefined {
    return this.quotaLedger?.snapshot();
  }

  attachScheduleRunner(runner: ScheduleRunner): void {
    this.scheduleRunner = runner;
  }

  async reloadSchedules(): Promise<void> {
    const manifest = scanAgentDirectory(this.config.identityDir);
    await this.scheduleRunner?.reload(
      loadSchedulesFromDisk(manifest.schedules),
    );
  }

  listSchedules(): Array<
    ScheduleDefinition & { lastFiredAt: number | null; inFlight: boolean }
  > {
    return this.scheduleRunner?.list() ?? [];
  }

  async upsertSchedule(input: {
    id: string;
    name?: string;
    every?: string;
    cron?: string;
    timezone?: string;
    action: ScheduleAction;
    enabled?: boolean;
    body: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.identity) {
      return { ok: false, error: 'identity storage is not configured' };
    }
    const sourcePath = this.identity.layout.scheduleFile(input.id);
    const result = validateScheduleFields({ ...input, sourcePath });
    if (!result.ok) return result;

    await fs.promises.mkdir(this.identity.layout.schedulesDir, {
      recursive: true,
    });
    await fs.promises.writeFile(
      sourcePath,
      serializeSchedule(result.value),
      'utf-8',
    );
    await this.commitScheduleChange(`update schedule ${input.id}`);
    await this.reloadSchedules();
    return { ok: true };
  }

  async setScheduleEnabled(
    id: string,
    enabled: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const schedule = this.listSchedules().find((item) => item.id === id);
    if (!schedule) return { ok: false, error: `schedule "${id}" not found` };
    await fs.promises.writeFile(
      schedule.sourcePath,
      serializeSchedule({ ...schedule, enabled }),
      'utf-8',
    );
    await this.commitScheduleChange(
      `set schedule ${id} ${enabled ? 'enabled' : 'disabled'}`,
    );
    await this.reloadSchedules();
    return { ok: true };
  }

  async deleteSchedule(
    id: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.identity) {
      return { ok: false, error: 'identity storage is not configured' };
    }
    if (!isSafeScheduleId(id)) {
      return { ok: false, error: 'id must be a safe schedule ID' };
    }
    const sourcePath = this.identity.layout.scheduleFile(id);
    try {
      await fs.promises.unlink(sourcePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, error: `schedule "${id}" not found` };
      }
      throw error;
    }
    if (this.scheduleRunner) {
      await this.scheduleRunner.remove(id);
    } else {
      const state = await this.store.readScheduleState();
      delete state.schedules[id];
      await this.store.writeScheduleState(state);
    }
    await this.commitScheduleChange(`delete schedule ${id}`);
    await this.reloadSchedules();
    return { ok: true };
  }

  private async commitScheduleChange(action: string): Promise<void> {
    if (this.identity instanceof IdentityGitSync) {
      await this.identity.commitPaths(action, ['agent/schedules/']);
    }
  }

  /** Explicit quota block from config (before env overrides). */
  getConfiguredQuota(): QuotaConfig | undefined {
    return this.config.quota;
  }

  /** Effective quota after auto-detect and env overrides. */
  getEffectiveQuotaConfig(): QuotaConfig | undefined {
    return buildQuotaConfig(this.config);
  }

  /** Replace quota config, reload ledger/router, and take effect on subsequent runs. */
  setQuotaConfig(quota: QuotaConfig): QuotaConfig {
    const normalized = normalizeQuotaConfig(quota, this.config);
    validateQuotaConfig(normalized);
    this.config.quota = stripDerivedQuotaFields(normalized);
    syncPrimaryRouteToRuntime(this.config, normalized.routes?.[0]);
    this.reinitializeQuota();
    return normalized;
  }

  private reinitializeQuota(): void {
    const quotaConfig = buildQuotaConfig(this.config);
    if (!quotaConfig) {
      this.quotaLedger = undefined;
      this.providerRouter = undefined;
      return;
    }
    this.quotaLedger = QuotaLedger.load(
      quotaConfig,
      this.store.layout.quotaStateFile(),
    );
    this.providerRouter = new ProviderRouter(
      this.config,
      this.quotaLedger,
      quotaConfig.routes ?? [],
      process.env,
      buildExecutor,
    );
  }

  resetQuotaWindow(
    accountId: string,
    windowId: string,
    workstreamId?: string,
  ): boolean {
    if (!this.quotaLedger) return false;
    const ok = this.quotaLedger.resetWindow(accountId, windowId, workstreamId);
    if (ok) void this.resumePausedWorkstreams();
    return ok;
  }

  getProviderConfig(): ProviderConfigSnapshot {
    return buildProviderConfigSnapshot(this.config, this.getQuotaSnapshot());
  }

  /** Apply provider/model/quota changes from a user request. Persists to config. */
  async updateProviderConfig(update: ProviderConfigUpdate): Promise<string> {
    const changes = applyProviderConfigUpdate(this.config, update);
    const normalized = normalizeQuotaConfig(this.config.quota, this.config);
    validateQuotaConfig(normalized);
    this.config.quota = stripDerivedQuotaFields(normalized);
    syncPrimaryRouteToRuntime(this.config, normalized.routes?.[0]);
    this.reinitializeQuota();
    await this.persistProviderConfig();
    return changes.join('; ');
  }

  /** Resolve a model id to an AI SDK model using the configured gateway. */
  private resolveModel = (modelId: string) =>
    resolveLanguageModel(modelId, {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
    });

  /**
   * Marks any runs left in `queued`/`running` state as failed. The run queue is
   * in-memory, so a restart abandons in-flight work; this is called at startup
   * to clean up those zombies instead of leaving them stuck forever.
   */
  async recoverZombieRuns(): Promise<RunRecord[]> {
    const runs = await this.store.listRuns();
    const recovered: RunRecord[] = [];
    for (const run of runs) {
      if (run.status !== 'running' && run.status !== 'queued') continue;
      run.status = 'failed';
      run.error = run.error ?? 'Interrupted by a runtime restart (zombie run).';
      run.finishedAt = new Date().toISOString();
      await this.store.saveRun(run);
      if (run.taskId && run.workstreamId) {
        await this.store.updateTask(run.workstreamId, run.taskId, {
          status: 'failed',
          result: run.error,
        });
      }
      recovered.push(run);
    }
    return recovered;
  }

  /**
   * Given the runs recovered at startup, advances the state machine for each
   * still-active workstream that had an interrupted call, so work resumes
   * instead of stalling at the failed step. Returns the number resumed.
   */
  async resumeInterruptedWorkstreams(recovered: RunRecord[]): Promise<number> {
    // One representative (latest) recovered run per workstream.
    const repByWorkstream = new Map<string, RunRecord>();
    for (const run of recovered) {
      if (!run.workstreamId) continue;
      const current = repByWorkstream.get(run.workstreamId);
      if (!current || run.createdAt > current.createdAt) {
        repByWorkstream.set(run.workstreamId, run);
      }
    }

    let resumed = 0;
    for (const [workstreamId, run] of repByWorkstream) {
      const ws = await this.store.getWorkstream(workstreamId);
      if (!ws || !Store.isActiveStatus(ws.status)) continue;
      await this.stepWorkstream(workstreamId, run.originMessageId);
      resumed += 1;
    }
    return resumed;
  }

  // --- Inbound messaging (the "person" surface) ---

  async receiveMessage(content: string): Promise<Message> {
    const message = await this.store.appendMessage({
      direction: 'inbound',
      content,
    });
    this.emit({ kind: 'message', at: message.createdAt, data: message });

    const route = this.resolveDispatchRoute({
      role: 'communicator',
      tier: this.config.roleTiers.communicator,
    });
    if (this.providerRouter && !route) {
      await this.reply(
        quotaPausedUserMessage({ resumesAt: this.quotaLedger?.nextReset() }),
      );
      return message;
    }

    // Prepend recent thread history so the communicator can understand
    // follow-up messages without asking for context that was already given.
    const RECENT_MESSAGE_LIMIT = 15;
    const allMessages = await this.store.listMessages();
    const recentPrior = allMessages
      .filter((m) => m.id !== message.id)
      .slice(-RECENT_MESSAGE_LIMIT);

    let task = content;
    if (recentPrior.length > 0) {
      const thread = recentPrior
        .map(
          (m) =>
            `[${m.direction === 'inbound' ? 'User' : 'Agent'}]: ${m.content}`,
        )
        .join('\n\n');
      task = `[Recent conversation]\n${thread}\n\n[New message]\n${content}`;
    }

    const run = await this.store.createRun({
      role: 'communicator',
      task,
      originMessageId: message.id,
      model: this.modelForRoute('communicator', undefined, route),
      routeProfileId: route?.profileId,
      routeAccountId: route?.accountId,
    });
    if (route) this.runRoutes.set(run.id, route);
    this.scheduler.enqueue(run.id);
    return message;
  }

  // --- EngineApi: used by tools ---

  listRoles(): string[] {
    return this.registry.listRoleNames();
  }

  async spawnCall(
    input: SpawnCallInput,
  ): Promise<{ runId: string; taskId?: string }> {
    const tier =
      input.complexity ??
      this.config.roleTiers[input.role as RoleName] ??
      'medium';
    const route = this.resolveDispatchRoute({
      role: input.role,
      workstreamId: input.workstreamId,
      tier,
    });
    if (this.providerRouter && !route) {
      await this.pauseAllForQuota();
      throw new Error('Quota exhausted; workstreams paused until reset.');
    }

    let taskId: string | undefined;

    if (input.workstreamId && input.role !== 'orchestrator') {
      const task = await this.store.createTask({
        workstreamId: input.workstreamId,
        role: input.role,
        description: input.description,
        status: 'pending',
        parentRunId: input.parentRunId,
      });
      taskId = task.id;
    }

    const run = await this.store.createRun({
      role: input.role,
      task: input.description,
      workstreamId: input.workstreamId,
      taskId,
      parentRunId: input.parentRunId,
      originMessageId: input.originMessageId,
      model: this.modelForRoute(input.role, input.complexity, route),
      routeProfileId: route?.profileId,
      routeAccountId: route?.accountId,
    });

    if (route) this.runRoutes.set(run.id, route);

    if (taskId && input.workstreamId) {
      await this.store.updateTask(input.workstreamId, taskId, {
        runId: run.id,
      });
    }

    this.scheduler.enqueue(run.id);
    return { runId: run.id, taskId };
  }

  /**
   * Create a workstream directly from a structured request, bypassing the
   * communicator. Used by structured intake (the bench harness) to remove
   * communicator variance and to allow a preflight clone before any agent
   * runs. An inbound message is recorded so cost/usage still attribute to a
   * single origin. With `autostart: false` the orchestrator is not spawned —
   * the caller can clone into the workspace first, then call kickoffWorkstream.
   */
  async createDirectWorkstream(input: {
    title: string;
    goal: string;
    repoUrl?: string;
    baseCommit?: string;
    autostart?: boolean;
    submitPr?: boolean;
  }): Promise<{ workstream: Workstream; messageId: string }> {
    const message = await this.store.appendMessage({
      direction: 'inbound',
      content: input.goal,
    });
    this.emit({ kind: 'message', at: message.createdAt, data: message });

    const ws = await this.store.createWorkstream({
      title: input.title,
      goal: input.goal,
      repoUrl: input.repoUrl,
      baseCommit: input.baseCommit,
      submitPr: input.submitPr,
      status: 'pending',
    });
    this.emit({ kind: 'workstream', at: ws.createdAt, data: ws });

    void this.memoryService?.onCreated(ws);
    if (input.autostart !== false) {
      await this.kickoffWorkstream(ws.id, message.id);
    }
    return { workstream: ws, messageId: message.id };
  }

  /** Spawn the orchestrator for a workstream created via createDirectWorkstream. */
  async kickoffWorkstream(
    workstreamId: string,
    originMessageId: string,
  ): Promise<void> {
    const ws = await this.store.getWorkstream(workstreamId);
    if (!ws) throw new Error(`workstream ${workstreamId} not found`);
    await this.stepWorkstream(workstreamId, originMessageId);
  }

  async startWorkstream(input: {
    title: string;
    goal: string;
    repoUrl?: string;
    baseCommit?: string;
    parentRunId?: string;
    originMessageId?: string;
  }): Promise<Workstream> {
    const ws = await this.store.createWorkstream({
      title: input.title,
      goal: input.goal,
      repoUrl: input.repoUrl,
      baseCommit: input.baseCommit,
      status: 'pending',
    });
    this.emit({ kind: 'workstream', at: ws.createdAt, data: ws });
    void this.memoryService?.onCreated(ws);

    await this.stepWorkstream(ws.id, input.originMessageId, input.parentRunId);
    return ws;
  }

  async reply(content: string, workstreamId?: string): Promise<void> {
    const message = await this.store.appendMessage({
      direction: 'outbound',
      content,
      workstreamId,
    });
    this.emit({ kind: 'message', at: message.createdAt, data: message });
  }

  /** Current model id for each complexity tier. */
  getModelTiers(): ModelTiers {
    return { ...this.config.models };
  }

  /**
   * Update one or more tier model ids. Takes effect for every run spawned
   * afterwards (the model id is resolved per run at spawn time).
   */
  setModelTiers(update: Partial<ModelTiers>): ModelTiers {
    this.config.models = { ...this.config.models, ...update };
    this.config.model = this.config.models.medium;
    this.config.modelPresetId = 'custom';
    return this.getModelTiers();
  }

  /** Update which complexity tier one or more roles use. */
  setRoleTiers(
    update: Partial<Record<RoleName, ModelTier>>,
  ): Record<RoleName, ModelTier> {
    this.config.roleTiers = { ...this.config.roleTiers, ...update };
    this.config.modelPresetId = 'custom';
    return { ...this.config.roleTiers };
  }

  getModelPresetId(): string {
    return this.config.modelPresetId;
  }

  /** Apply a named preset (tiers + role map). Takes effect on subsequent runs. */
  applyPreset(presetId: string): {
    preset: ModelPreset;
    tiers: ModelTiers;
    roleTiers: Record<RoleName, ModelTier>;
  } {
    const preset = getPreset(presetId);
    if (!preset) {
      throw new Error(`Unknown model preset: ${presetId}`);
    }
    this.config.models = { ...preset.tiers };
    this.config.model = preset.tiers.medium;
    this.config.roleTiers = cloneRoleTiers(preset.roleTiers);
    this.config.modelPresetId = preset.id;
    return {
      preset,
      tiers: this.getModelTiers(),
      roleTiers: { ...this.config.roleTiers },
    };
  }

  /**
   * Write the current model config back to artificer.config.json and commit it.
   * No-op if identityDir has no config file and no git repo. Commit only runs
   * when identity.autoCommit is true.
   */
  async persistConfig(): Promise<void> {
    const configPath = path.join(
      this.config.identityDir,
      'artificer.config.json',
    );

    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<
        string,
        unknown
      >;
    } catch {
      /* file may not exist yet */
    }

    const presetId = this.config.modelPresetId;
    let updated: Record<string, unknown>;
    if (presetId !== 'custom') {
      const { models: _m, roleTiers: _r, ...rest } = existing;
      updated = { ...rest, preset: presetId };
    } else {
      const { preset: _p, ...rest } = existing;
      updated = {
        ...rest,
        models: { ...this.config.models },
        roleTiers: { ...this.config.roleTiers },
      };
    }

    try {
      fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');
    } catch (err) {
      console.error('[engine] failed to write artificer.config.json:', err);
      return;
    }

    if (!this.config.identity?.autoCommit) return;

    const dir = this.config.identityDir;
    const env = buildGitEnv(this.config.github);
    const prefix = this.config.identity.commitPrefix ?? 'config:';
    const label =
      presetId !== 'custom' ? `preset to ${presetId}` : 'models (custom)';
    const message = `${prefix} update ${label}`;

    try {
      await exec('git', ['-C', dir, 'add', 'artificer.config.json'], { env });
    } catch (err) {
      console.error('[engine] git add config failed:', err);
      return;
    }

    try {
      await exec('git', ['-C', dir, 'commit', '-m', message], { env });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !msg.includes('nothing to commit') &&
        !msg.includes('nothing added')
      ) {
        console.error('[engine] git commit config failed:', err);
      }
      return;
    }

    if (!this.config.identity.autoPush) return;

    try {
      const remote = this.config.identity.remote ?? 'origin';
      const pushArgs = ['push', remote];
      if (this.config.identity.branch) {
        pushArgs.push(this.config.identity.branch);
      } else {
        const { stdout } = await exec(
          'git',
          ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
          { env },
        );
        const branch = stdout.trim();
        if (branch && branch !== 'HEAD') pushArgs.push(branch);
      }
      await exec('git', ['-C', dir, ...pushArgs], { env });
    } catch (err) {
      console.error('[engine] git push config failed:', err);
    }
  }

  /**
   * Write model preset/tiers and quota routes to artificer.config.json.
   * Replaces separate persistConfig + persistQuotaConfig for agent-driven updates.
   */
  async persistProviderConfig(): Promise<void> {
    const configPath = path.join(
      this.config.identityDir,
      'artificer.config.json',
    );

    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<
        string,
        unknown
      >;
    } catch {
      /* file may not exist yet */
    }

    const presetId = this.config.modelPresetId;
    const {
      preset: _p,
      models: _m,
      roleTiers: _r,
      quota: _q,
      ...rest
    } = existing;
    let updated: Record<string, unknown> = { ...rest };

    if (presetId !== 'custom') {
      updated.preset = presetId;
    } else {
      updated.models = { ...this.config.models };
      updated.roleTiers = { ...this.config.roleTiers };
    }

    if (this.config.quota?.routes?.length) {
      updated.quota = stripDerivedQuotaFields(
        normalizeQuotaConfig(this.config.quota, this.config),
      );
    } else if (this.config.quota) {
      updated.quota = this.config.quota;
    }

    try {
      fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');
    } catch (err) {
      console.error('[engine] failed to write provider config:', err);
      return;
    }

    if (!this.config.identity?.autoCommit) return;

    const dir = this.config.identityDir;
    const env = buildGitEnv(this.config.github);
    const prefix = this.config.identity.commitPrefix ?? 'config:';
    const message = `${prefix} update provider configuration`;

    try {
      await exec('git', ['-C', dir, 'add', 'artificer.config.json'], { env });
    } catch (err) {
      console.error('[engine] git add provider config failed:', err);
      return;
    }

    try {
      await exec('git', ['-C', dir, 'commit', '-m', message], { env });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        !msg.includes('nothing to commit') &&
        !msg.includes('nothing added')
      ) {
        console.error('[engine] git commit provider config failed:', err);
      }
      return;
    }

    if (!this.config.identity.autoPush) return;

    try {
      const remote = this.config.identity.remote ?? 'origin';
      const pushArgs = ['push', remote];
      if (this.config.identity.branch) {
        pushArgs.push(this.config.identity.branch);
      } else {
        const { stdout } = await exec(
          'git',
          ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
          { env },
        );
        const branch = stdout.trim();
        if (branch && branch !== 'HEAD') pushArgs.push(branch);
      }
      await exec('git', ['-C', dir, ...pushArgs], { env });
    } catch (err) {
      console.error('[engine] git push provider config failed:', err);
    }
  }

  /** Resolve the model id for a role, honoring an optional complexity override. */
  private modelFor(role: RunRecord['role'], complexity?: ModelTier): string {
    return pickModel(
      this.config.models,
      this.config.roleTiers,
      role as RoleName,
      complexity,
    );
  }

  private modelForRoute(
    role: string,
    complexity: ModelTier | undefined,
    route?: DispatchRoute,
  ): string {
    if (!route) return this.modelFor(role, complexity);
    return pickModel(
      route.models,
      route.roleTiers,
      role as RoleName,
      complexity,
    );
  }

  private resolveDispatchRoute(
    input: ResolveRouteInput,
  ): DispatchRoute | undefined {
    if (!this.providerRouter) return undefined;
    return this.providerRouter.resolve(input) ?? undefined;
  }

  private resolveModelForRoute = (route?: DispatchRoute) => (modelId: string) =>
    resolveLanguageModel(modelId, {
      apiKey: route?.apiKey ?? this.config.apiKey,
      baseURL: route?.baseURL ?? this.config.baseURL,
    });

  emit(event: RuntimeEvent): void {
    this.events.emit('event', event);
  }

  // --- Subscriptions (for SSE) ---

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  // --- Execution ---

  private async runOne(runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) return;

    this.active.set(runId, {
      runId,
      role: run.role,
      workstreamId: run.workstreamId,
      startedAt: new Date().toISOString(),
    });

    try {
      const route = this.runRoutes.get(runId);
      const finished = await executeCall(run, {
        resolveModel: this.resolveModelForRoute(route),
        config: this.config,
        store: this.store,
        engine: this,
        executor: route
          ? executorForRoute(route, buildExecutor, this.executor)
          : this.executor,
        registry: this.registry,
        route,
      });
      this.runRoutes.delete(runId);
      await this.afterRun(finished);
    } finally {
      this.active.delete(runId);
    }
  }

  /** Workstream statuses from which no further work is dispatched. */
  private static readonly FSM_TERMINAL = new Set<string>([
    'done',
    'blocked',
    'failed',
    'cancelled',
    'paused_quota',
  ]);

  private static readonly STATUS_FOR_ROLE: Record<string, WorkstreamStatus> = {
    planner: 'planning',
    worker: 'in_progress',
    reviewer: 'reviewing',
  };

  /**
   * Advance a workstream one deterministic step: gather facts, ask the state
   * machine for the next action, and execute it. This replaces the LLM
   * orchestrator — routing is mechanical, so it lives in code.
   */
  private async stepWorkstream(
    workstreamId: string,
    originMessageId?: string,
    parentRunId?: string,
  ): Promise<void> {
    const ws = await this.store.getWorkstream(workstreamId);
    if (!ws || Engine.FSM_TERMINAL.has(ws.status)) return;

    const { facts, workerRunsSinceReview } = await this.computeFacts(ws);
    const action = nextWorkstreamAction(facts);

    switch (action.kind) {
      case 'setup': {
        const workspaceDir =
          this.store.layout.workstreamWorkspace(workstreamId);
        try {
          await cloneRepoIntoWorkspace(
            workspaceDir,
            ws.repoUrl ?? '',
            ws.baseCommit,
            buildGitEnv(this.config.github),
          );
        } catch (err) {
          await this.blockWorkstream(
            ws,
            `setup_failed: could not clone ${ws.repoUrl} (${err instanceof Error ? err.message : String(err)})`,
          );
          return;
        }
        // Repo is ready now — continue without waiting for another tick.
        await this.stepWorkstream(workstreamId, originMessageId, parentRunId);
        return;
      }
      case 'dispatch': {
        const status = Engine.STATUS_FOR_ROLE[action.role];
        if (status && ws.status !== status) {
          await this.store.updateWorkstream(workstreamId, { status });
          await this.emitWorkstream(workstreamId);
        }
        let task = action.task;
        if (action.role === 'worker' && workerRunsSinceReview.length > 0) {
          const priorContext = buildPriorWorkContext(workerRunsSinceReview);
          if (priorContext) task = `${task}\n\n${priorContext}`;
        }
        await this.spawnCall({
          role: action.role,
          description: task,
          workstreamId,
          parentRunId,
          originMessageId,
        });
        return;
      }
      case 'done': {
        await this.store.updateWorkstream(workstreamId, { status: 'done' });
        await this.emitWorkstream(workstreamId);
        const doneWs = await this.store.getWorkstream(workstreamId);
        const doneMsg = doneWs?.summary
          ? `Workstream "${ws.title}" is complete.\n\n${doneWs.summary}`
          : `Workstream "${ws.title}" is complete.`;
        await this.reply(doneMsg, workstreamId);
        if (doneWs) void this.handleWorkstreamTerminal(doneWs);
        return;
      }
      case 'blocked':
        await this.blockWorkstream(ws, action.reason);
        return;
    }
  }

  /**
   * Gather the facts the state machine transitions on.
   *
   * Several of these counters (workerRunsSinceReview, noProgressRepeats,
   * consecutiveFailedRuns, plannerRunsWithoutPlan, totalRuns) are
   * independently re-derived from the same raw records by
   * `computeRetryCounters` in workstream-retry-counters.ts, for display on
   * the API/UI progress badges. If you change how a counter is computed
   * here, check that file for the same drift.
   */
  private async computeFacts(
    ws: Workstream,
  ): Promise<{ facts: WorkstreamFacts; workerRunsSinceReview: RunRecord[] }> {
    const workspaceDir = this.store.layout.workstreamWorkspace(ws.id);
    const repoDir = await findGitRepo(workspaceDir);
    const patchPresent = repoDir ? await hasUncommittedChanges(repoDir) : false;
    const [plan, reviewsRaw, wsRuns] = await Promise.all([
      this.store.readPlan(ws.id),
      this.store.listReviews(ws.id),
      this.store.listRunsForWorkstream(ws.id),
    ]);
    const reviews = [...reviewsRaw].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const lastReview = reviews.at(-1);
    const workerRunsSinceReview = wsRuns
      .filter(
        (r) =>
          r.role === 'worker' &&
          r.status === 'done' &&
          (!lastReview || r.createdAt > lastReview.createdAt),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const workSinceLastReview = workerRunsSinceReview.length;
    // The worker reports its outcome via report_status (DONE / BLOCKED / …);
    // treat a DONE(_WITH_CONCERNS) as "ready for review" so we don't review a
    // half-finished large task.
    const lastWorker = workerRunsSinceReview.at(-1);
    const lastWorkerDone = lastWorker ? workerRunDone(lastWorker) : false;
    const noProgressRepeats = countNoProgressRepeats(workerRunsSinceReview);
    const ordered = [...wsRuns].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    let consecutiveFailedRuns = 0;
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      if (ordered[i].status === 'failed') consecutiveFailedRuns += 1;
      else break;
    }
    // When no plan exists, every completed planner run failed to produce one.
    const plannerRunsWithoutPlan = plan
      ? 0
      : wsRuns.filter((r) => r.role === 'planner' && r.status === 'done')
          .length;

    // A PR is submitted if the submit-specific worker ran after the last
    // approval and reported done/done_with_concerns. Checking the task text
    // prevents implement/fix workers (dispatched before the approve+submit
    // routing was reached) from being mistaken for a submit run — which would
    // cause the machine to return 'done' before any PR was opened.
    const prSubmitted =
      lastReview?.approved === true &&
      wsRuns.some(
        (r) =>
          r.role === 'worker' &&
          r.status === 'done' &&
          r.createdAt > lastReview.createdAt &&
          r.task.startsWith('The review approved') &&
          workerRunDone(r),
      );

    return {
      facts: {
        hasRepoUrl: Boolean(ws.repoUrl),
        submitPr: ws.submitPr !== false,
        repoReady: repoDir !== undefined,
        planWritten: Boolean(plan),
        patchPresent,
        reviewCount: reviews.length,
        lastReviewApproved: lastReview?.approved,
        workSinceLastReview,
        lastWorkerDone,
        consecutiveFailedRuns,
        plannerRunsWithoutPlan,
        noProgressRepeats,
        prSubmitted,
        totalRuns: wsRuns.length,
        maxRuns: this.config.maxRunsPerWorkstream,
      },
      workerRunsSinceReview,
    };
  }

  async cancelWorkstream(id: string): Promise<boolean> {
    const ws = await this.store.getWorkstream(id);
    if (!ws || Engine.FSM_TERMINAL.has(ws.status)) return false;
    await this.store.updateWorkstream(id, { status: 'cancelled' });
    await this.emitWorkstream(id);
    const updated = await this.store.getWorkstream(id);
    if (updated) void this.handleWorkstreamTerminal(updated);
    return true;
  }

  private async blockWorkstream(ws: Workstream, reason: string): Promise<void> {
    await this.store.updateWorkstream(ws.id, {
      status: 'blocked',
      summary: `${ws.summary ?? ''}\n\n[System] ${reason}`.trim(),
    });
    await this.emitWorkstream(ws.id);
    await this.reply(`Workstream "${ws.title}" paused: ${reason}`, ws.id);
    const updated = await this.store.getWorkstream(ws.id);
    if (updated) void this.handleWorkstreamTerminal(updated);
  }

  /**
   * Update the workstream chronicle, then optionally spawn a fire-and-forget
   * librarian distill (claim/entity extraction). Failures only log.
   */
  private async handleWorkstreamTerminal(ws: Workstream): Promise<void> {
    if (!this.memoryService) return;
    try {
      await this.memoryService.onTerminal(ws);
      if (this.config.identity?.distillWorkstreams === false) return;
      await this.memoryService.requestDistill(ws, (input) =>
        this.spawnCall(input),
      );
    } catch (err) {
      console.error(
        `[workstream-memory] terminal handling failed for ${ws.id}:`,
        err,
      );
    }
  }

  private async emitWorkstream(workstreamId: string): Promise<void> {
    const ws = await this.store.getWorkstream(workstreamId);
    if (ws) {
      this.emit({
        kind: 'workstream',
        at: ws.updatedAt ?? ws.createdAt,
        data: ws,
      });
    }
  }

  /** After a work call finishes, advance the workstream state machine. */
  private async afterRun(run: RunRecord): Promise<void> {
    // The communicator's output is user-facing; if it answered in text without
    // ever using the reply tool, deliver that text so the message isn't lost.
    if (run.role === 'communicator' && run.status === 'done') {
      const replied = run.toolCalls.some((t) => t.name === 'reply' && !t.error);
      const text = run.output?.trim();
      if (!replied && text) await this.reply(text, run.workstreamId);
    }

    if (run.taskId && run.workstreamId) {
      const workerSummary =
        run.role === 'worker' ? workerRunSummary(run) : undefined;
      await this.store.updateTask(run.workstreamId, run.taskId, {
        status: run.status === 'failed' ? 'failed' : 'done',
        result: workerSummary ?? run.output ?? run.error,
      });
    }

    if (run.status === 'failed' && isInsufficientBalanceError(run.error)) {
      await this.handleInsufficientBalance(run);
      return;
    }

    if (run.status === 'failed' && isQuotaExhaustedError(run.error)) {
      await this.handleQuotaExhausted(run);
      return;
    }

    this.recordRunQuotaUsage(run);

    // Only the generative work roles drive the state machine forward; the
    // deterministic FSM decides what (if anything) happens next.
    const isWork =
      run.role === 'planner' ||
      run.role === 'worker' ||
      run.role === 'reviewer';
    if (!isWork || !run.workstreamId) return;

    // A planner often writes its plan as prose in its final answer instead of
    // calling write_plan (especially for long plans). Capture that text as the
    // plan so its work isn't thrown away and the machine can advance to
    // implementation, mirroring the communicator's reply fallback above.
    if (run.role === 'planner' && run.status === 'done') {
      const wrotePlan = run.toolCalls.some(
        (t) => t.name === 'write_plan' && !t.error,
      );
      const text = run.output?.trim();
      if (!wrotePlan && text && text.length > 200) {
        const existing = await this.store.readPlan(run.workstreamId);
        if (!existing) await this.store.writePlan(run.workstreamId, text);
      }
      const plan = await this.store.readPlan(run.workstreamId);
      if (plan) {
        const planWs = await this.store.getWorkstream(run.workstreamId);
        if (planWs) void this.memoryService?.onPlanWritten(planWs, plan);
      }
    }

    if (run.role === 'worker' && run.status === 'done') {
      const workerWs = await this.store.getWorkstream(run.workstreamId);
      if (workerWs) void this.memoryService?.onWorkerRunFinished(workerWs, run);
    }

    if (run.role === 'reviewer' && run.status === 'done') {
      const reviews = await this.store.listReviews(run.workstreamId);
      const latestReview = reviews.sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0];
      if (latestReview) {
        const reviewWs = await this.store.getWorkstream(run.workstreamId);
        if (reviewWs)
          void this.memoryService?.onReviewCompleted(reviewWs, latestReview);
      }
    }

    await this.stepWorkstream(run.workstreamId, run.originMessageId, run.id);
  }

  /** Notify the user once and pause active work when billing blocks LLM calls. */
  private async handleInsufficientBalance(run: RunRecord): Promise<void> {
    const notifyKey = run.workstreamId ?? run.originMessageId ?? run.id;
    if (this.balanceNotified.has(notifyKey)) return;
    this.balanceNotified.add(notifyKey);

    const model = run.model ?? this.config.model;
    let workstreamTitle: string | undefined;

    if (run.workstreamId) {
      const ws = await this.store.getWorkstream(run.workstreamId);
      workstreamTitle = ws?.title;
      if (ws && Store.isActiveStatus(ws.status)) {
        await this.store.updateWorkstream(run.workstreamId, {
          status: 'blocked',
          summary:
            `${ws.summary}\n\n[System] Paused: LLM call failed due to insufficient API balance (model: ${model}).`.trim(),
        });
      }
    }

    await this.reply(
      insufficientBalanceUserMessage({ model, workstreamTitle }),
      run.workstreamId,
    );
  }

  private recordRunQuotaUsage(run: RunRecord): void {
    if (!this.quotaLedger || run.status !== 'done') return;
    const accountId =
      run.routeAccountId ?? this.providerRouter?.getPrimaryAccountId();
    if (!accountId) return;

    if (run.executor) {
      this.quotaLedger.recordExecutorInvocation(
        accountId,
        run.role,
        run.workstreamId,
      );
      return;
    }

    const account = this.quotaLedger.getAccountConfig(accountId);
    const source =
      account?.mode === 'metered' ? 'metered' : ('estimated' as const);
    this.quotaLedger.recordLlmRun(accountId, run, source);
  }

  private async handleQuotaExhausted(run: RunRecord): Promise<void> {
    const accountId =
      run.routeAccountId ?? this.providerRouter?.getPrimaryAccountId();
    if (accountId) {
      const retryMs = run.error ? quotaRetryAfterMs(run.error) : undefined;
      const resetsAt = retryMs
        ? new Date(Date.now() + retryMs).toISOString()
        : this.quotaLedger?.nextReset();
      this.quotaLedger?.markAccountExhausted(accountId, resetsAt);
    }

    const account = accountId
      ? this.quotaLedger?.getAccountConfig(accountId)
      : undefined;
    if (account?.onExhausted === 'failover' && run.workstreamId) {
      await this.stepWorkstream(run.workstreamId, run.originMessageId, run.id);
      return;
    }

    await this.pauseAllForQuota();
  }

  private async pauseAllForQuota(): Promise<void> {
    if (!this.quotaLedger) return;
    const resumesAt = this.quotaLedger.nextReset();
    const notifyKey = resumesAt ?? 'quota';
    if (!this.quotaNotified.has(notifyKey)) {
      this.quotaNotified.add(notifyKey);
      this.emit({
        kind: 'quota',
        at: new Date().toISOString(),
        data: { event: 'exhausted', resumesAt },
      });
      await this.reply(quotaPausedUserMessage({ resumesAt }));
    }

    const workstreams = await this.store.listWorkstreams();
    for (const ws of workstreams) {
      if (!Store.isActiveStatus(ws.status) || ws.status === 'paused_quota') {
        continue;
      }
      this.quotaLedger.recordPausedWorkstream(ws.id, ws.status);
      await this.store.updateWorkstream(ws.id, {
        status: 'paused_quota',
        quotaPausedStatus: ws.status,
        summary:
          `${ws.summary}\n\n[System] Paused: usage quota reached.${resumesAt ? ` Resumes around ${resumesAt}.` : ''}`.trim(),
      });
      await this.emitWorkstream(ws.id);
    }
    this.scheduleQuotaResume();
  }

  private async resumePausedWorkstreams(): Promise<void> {
    if (!this.quotaLedger) return;
    const paused = this.quotaLedger.getPausedWorkstreams();
    for (const [workstreamId, priorStatus] of Object.entries(paused)) {
      const ws = await this.store.getWorkstream(workstreamId);
      if (!ws || ws.status !== 'paused_quota') {
        this.quotaLedger.clearPausedWorkstream(workstreamId);
        continue;
      }
      await this.store.updateWorkstream(workstreamId, {
        status: priorStatus as WorkstreamStatus,
        quotaPausedStatus: undefined,
      });
      this.quotaLedger.clearPausedWorkstream(workstreamId);
      await this.emitWorkstream(workstreamId);
      const latest = await this.store.getWorkstream(workstreamId);
      if (latest && !Engine.FSM_TERMINAL.has(latest.status)) {
        await this.stepWorkstream(workstreamId);
      }
    }
    this.quotaNotified.clear();
    this.emit({
      kind: 'quota',
      at: new Date().toISOString(),
      data: { event: 'resumed' },
    });
  }

  private scheduleQuotaResume(): void {
    if (!this.quotaLedger) return;
    const ms = this.quotaLedger.nextResetMs();
    if (ms === undefined) return;
    if (this.quotaResumeTimer) clearTimeout(this.quotaResumeTimer);
    this.quotaResumeTimer = setTimeout(
      () => {
        this.quotaLedger?.tick();
        void this.resumePausedWorkstreams();
        this.scheduleQuotaResume();
      },
      Math.min(ms + 500, 2_147_483_647),
    );
  }

  private scheduleQuotaTick(): void {
    if (!this.quotaLedger) return;
    const primary = this.providerRouter?.getPrimaryAccountId();
    const pollMs =
      (primary
        ? this.quotaLedger.getAccountConfig(primary)?.pollIntervalMs
        : undefined) ?? 300_000;
    const timer = setInterval(() => {
      this.quotaLedger?.tick();
      const paused = this.quotaLedger?.getPausedWorkstreams() ?? {};
      if (Object.keys(paused).length > 0) {
        void this.resumePausedWorkstreams();
      }
      const primaryId = this.providerRouter?.getPrimaryAccountId();
      if (
        primaryId &&
        this.quotaLedger &&
        !this.quotaLedger.isAccountExhausted(primaryId)
      ) {
        const wasFailover =
          this.quotaLedger.getActiveRoute(primaryId) !== 'primary';
        this.quotaLedger.clearActiveRoute(primaryId);
        if (wasFailover) {
          this.emit({
            kind: 'quota',
            at: new Date().toISOString(),
            data: { event: 'failover_cleared', accountId: primaryId },
          });
        }
      }
    }, pollMs);
    timer.unref();
  }

  // --- State snapshot ---

  async getState(): Promise<RuntimeState> {
    const workstreams = await this.store.listWorkstreams();
    return {
      agentName: this.config.agentName,
      busy: this.scheduler.running > 0 || this.scheduler.pending > 0,
      queue: {
        pending: this.scheduler.pending,
        running: this.scheduler.running,
      },
      activeRuns: [...this.active.values()],
      workstreams: workstreams.map((ws) => ({
        id: ws.id,
        title: ws.title,
        status: ws.status,
        summary: ws.summary,
        updatedAt: ws.updatedAt,
      })),
    };
  }
}

function buildExecutor(
  config: RuntimeConfig['executor'],
): WorkerExecutor | undefined {
  if (!config || config === 'llm') return undefined;
  if (config === 'cursor-agent') return new CursorAgentExecutor();
  if (config === 'claude-code') return new ClaudeCodeExecutor();
  if (config.type === 'cursor-agent')
    return new CursorAgentExecutor(config.model);
  if (config.type === 'claude-code')
    return new ClaudeCodeExecutor(config.model);
  if (config.type === 'cli') return new CliExecutor(config);
  return undefined;
}
