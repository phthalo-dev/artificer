import { EventEmitter } from 'node:events';
import type { RuntimeConfig } from '../config.js';
import type { EngineApi, RuntimeEvent, SpawnCallInput } from '../context.js';
import { resolveLanguageModel } from '../llm/provider.js';
import { Store } from '../storage/store.js';
import type {
  Message,
  RunRecord,
  Workstream,
  WorkstreamStatus,
} from '../storage/types.js';
import { executeCall } from './call.js';
import { findGitRepo } from './git-repo.js';
import { cloneRepoIntoWorkspace, hasUncommittedChanges } from './git-ops.js';
import {
  nextWorkstreamAction,
  type WorkstreamFacts,
} from './workstream-machine.js';
import { buildGitEnv } from '../tools/git-env.js';
import {
  insufficientBalanceUserMessage,
  isInsufficientBalanceError,
} from '../llm/errors.js';
import { type ModelTier, type ModelTiers, pickModel } from './models.js';
import {
  cloneRoleTiers,
  getPreset,
  type ModelPreset,
} from './presets.js';
import { Scheduler } from './scheduler.js';
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
  readonly config: RuntimeConfig;
  private readonly scheduler: Scheduler;
  private readonly events = new EventEmitter();
  private readonly active = new Map<string, ActiveRun>();
  /** Avoid spamming the user when many concurrent calls hit the same billing wall. */
  private readonly balanceNotified = new Set<string>();

  constructor(config: RuntimeConfig, store: Store) {
    this.config = config;
    this.store = store;
    this.scheduler = new Scheduler(config.concurrency, (runId) =>
      this.runOne(runId),
    );
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
      run.error =
        run.error ?? 'Interrupted by a runtime restart (zombie run).';
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
   * Given the runs recovered at startup, re-invokes the orchestrator for each
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
      await this.spawnCall({
        role: 'orchestrator',
        description:
          'The runtime restarted and an in-flight call for this workstream was interrupted. Review the current status with get_status and decide how to continue.',
        workstreamId,
        originMessageId: run.originMessageId,
      });
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

    const run = await this.store.createRun({
      role: 'communicator',
      task: content,
      originMessageId: message.id,
      model: this.modelFor('communicator'),
    });
    this.scheduler.enqueue(run.id);
    return message;
  }

  // --- EngineApi: used by tools ---

  async spawnCall(
    input: SpawnCallInput,
  ): Promise<{ runId: string; taskId?: string }> {
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
      model: this.modelFor(input.role, input.complexity),
    });

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
      status: 'pending',
    });
    this.emit({ kind: 'workstream', at: ws.createdAt, data: ws });

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
  setRoleTiers(update: Partial<Record<RoleName, ModelTier>>): Record<
    RoleName,
    ModelTier
  > {
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

  /** Resolve the model id for a role, honoring an optional complexity override. */
  private modelFor(role: RunRecord['role'], complexity?: ModelTier): string {
    return pickModel(
      this.config.models,
      this.config.roleTiers,
      role,
      complexity,
    );
  }

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
      const finished = await executeCall(run, {
        resolveModel: this.resolveModel,
        config: this.config,
        store: this.store,
        engine: this,
      });
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

    const action = nextWorkstreamAction(await this.computeFacts(ws));

    switch (action.kind) {
      case 'setup': {
        const workspaceDir = this.store.layout.workstreamWorkspace(workstreamId);
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
        await this.spawnCall({
          role: action.role,
          description: action.task,
          workstreamId,
          parentRunId,
          originMessageId,
        });
        return;
      }
      case 'done':
        await this.store.updateWorkstream(workstreamId, { status: 'done' });
        await this.emitWorkstream(workstreamId);
        await this.reply(`Workstream "${ws.title}" is complete.`, workstreamId);
        return;
      case 'blocked':
        await this.blockWorkstream(ws, action.reason);
        return;
    }
  }

  /** Gather the facts the state machine transitions on. */
  private async computeFacts(ws: Workstream): Promise<WorkstreamFacts> {
    const workspaceDir = this.store.layout.workstreamWorkspace(ws.id);
    const repoDir = await findGitRepo(workspaceDir);
    const patchPresent = repoDir
      ? await hasUncommittedChanges(repoDir)
      : false;
    const [plan, reviewsRaw, wsRuns] = await Promise.all([
      this.store.readPlan(ws.id),
      this.store.listReviews(ws.id),
      this.store.listRunsForWorkstream(ws.id),
    ]);
    const reviews = [...reviewsRaw].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const lastReview = reviews.at(-1);
    const workSinceLastReview = wsRuns.filter(
      (r) =>
        r.role === 'worker' &&
        r.status === 'done' &&
        (!lastReview || r.createdAt > lastReview.createdAt),
    ).length;
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
      : wsRuns.filter((r) => r.role === 'planner' && r.status === 'done').length;
    return {
      hasRepoUrl: Boolean(ws.repoUrl),
      repoReady: repoDir !== undefined,
      planWritten: Boolean(plan),
      patchPresent,
      reviewCount: reviews.length,
      lastReviewApproved: lastReview?.approved,
      workSinceLastReview,
      consecutiveFailedRuns,
      plannerRunsWithoutPlan,
      totalRuns: wsRuns.length,
      maxRuns: this.config.maxRunsPerWorkstream,
    };
  }

  private async blockWorkstream(ws: Workstream, reason: string): Promise<void> {
    await this.store.updateWorkstream(ws.id, {
      status: 'blocked',
      summary: `${ws.summary ?? ''}\n\n[System] ${reason}`.trim(),
    });
    await this.emitWorkstream(ws.id);
    await this.reply(`Workstream "${ws.title}" paused: ${reason}`, ws.id);
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
      await this.store.updateTask(run.workstreamId, run.taskId, {
        status: run.status === 'failed' ? 'failed' : 'done',
        result: run.output ?? run.error,
      });
    }

    if (run.status === 'failed' && isInsufficientBalanceError(run.error)) {
      await this.handleInsufficientBalance(run);
      return;
    }

    // Only the generative work roles drive the state machine forward; the
    // deterministic FSM decides what (if anything) happens next.
    const isWork =
      run.role === 'planner' ||
      run.role === 'worker' ||
      run.role === 'reviewer';
    if (!isWork || !run.workstreamId) return;

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

  // --- State snapshot ---

  async getState(): Promise<RuntimeState> {
    const workstreams = await this.store.listWorkstreams();
    return {
      agentName: this.config.agentName,
      busy: this.scheduler.running > 0 || this.scheduler.pending > 0,
      queue: { pending: this.scheduler.pending, running: this.scheduler.running },
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
