import { EventEmitter } from 'node:events';
import type { RuntimeConfig } from '../config.js';
import type { EngineApi, RuntimeEvent, SpawnCallInput } from '../context.js';
import { resolveLanguageModel } from '../llm/provider.js';
import { Store } from '../storage/store.js';
import type { Message, RunRecord, Workstream } from '../storage/types.js';
import { executeCall } from './call.js';
import { findGitRepo } from './git-repo.js';
import { recordPlanReviewFallback } from './spawn-guards.js';
import {
  insufficientBalanceUserMessage,
  isInsufficientBalanceError,
} from '../llm/errors.js';
import {
  convergenceStallMessage,
  detectConvergenceStall,
} from './convergence.js';
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

const RUN_ROLES_THAT_REINVOKE = ['planner', 'reviewer', 'worker'] as const;

const WORK_ROLES = ['planner', 'reviewer', 'worker'] as const;

/**
 * How many consecutive "work" calls may produce no usable result before the
 * workstream is paused. Guards against thrash loops such as a reviewer that
 * never calls submit_review, which would otherwise make the orchestrator
 * re-spawn reviewers until the run cap / wall-clock timeout.
 */
const MAX_UNPRODUCTIVE_WORK_RUNS = 3;

/** True if the run made a successful (non-erroring) call to the named tool. */
function hasSuccessfulTool(run: RunRecord, name: string): boolean {
  return run.toolCalls.some((t) => t.name === name && !t.error);
}

/**
 * A work call that finished without producing its expected artifact: a
 * reviewer that never submitted a review, a planner that never wrote a plan,
 * or any work call that failed. Workers are only flagged when they fail, since
 * their useful output is varied and hard to detect structurally.
 *
 * Planner runs during repo setup (no local clone yet) are not counted as
 * unproductive — that is a setup failure, not model thrash.
 */
async function isUnproductiveWorkRun(
  run: RunRecord,
  store: Store,
): Promise<boolean> {
  if (!(WORK_ROLES as readonly string[]).includes(run.role)) return false;
  if (run.status === 'failed') return true;
  if (run.role === 'reviewer') return !hasSuccessfulTool(run, 'submit_review');
  if (run.role === 'planner') {
    if (hasSuccessfulTool(run, 'write_plan')) return false;
    if (run.workstreamId) {
      const ws = await store.getWorkstream(run.workstreamId);
      if (ws?.repoUrl) {
        const workspaceDir = store.layout.workstreamWorkspace(run.workstreamId);
        const localRepo = await findGitRepo(workspaceDir);
        if (!localRepo) return false;
      }
    }
    return true;
  }
  return false;
}

/** Count of trailing consecutive unproductive work runs in a workstream. */
async function trailingUnproductiveWorkRuns(
  runs: RunRecord[],
  store: Store,
): Promise<number> {
  const work = runs
    .filter((r) => (WORK_ROLES as readonly string[]).includes(r.role))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let count = 0;
  for (let i = work.length - 1; i >= 0; i -= 1) {
    if (await isUnproductiveWorkRun(work[i], store)) count += 1;
    else break;
  }
  return count;
}

/**
 * The summary the orchestrator sees about a just-finished child. When a
 * reviewer or planner produced nothing, says so explicitly so the orchestrator
 * does not blindly repeat the same step.
 */
function describeOutcome(run: RunRecord): string {
  if (run.status === 'failed') {
    return `A ${run.role} call failed: ${run.error ?? 'unknown error'}.`;
  }
  if (run.role === 'reviewer' && !hasSuccessfulTool(run, 'submit_review')) {
    return `A reviewer call finished but did NOT submit a review (no verdict was recorded). Do not simply spawn another identical reviewer: if the plan/work already looks adequate, proceed to the next step; if a review is essential, re-spawn it at a higher complexity or escalate to the user.`;
  }
  if (run.role === 'planner' && !hasSuccessfulTool(run, 'write_plan')) {
    return `A planner call finished but did NOT write a plan (no plan artifact was saved). Re-spawn the planner at a higher complexity with clearer instructions, or escalate to the user.`;
  }
  return `A ${run.role} call finished. Result:\n${run.output ?? '(no output)'}`;
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
  /**
   * Workstreams with an orchestrator call already queued but not yet started.
   * Used to coalesce the re-invocations that fan-out produces: when an
   * orchestrator spawns several children, each one finishing would otherwise
   * enqueue its own orchestrator pass. We keep just one pending pass, which
   * sees all the completed work via get_status.
   */
  private readonly orchestratorQueued = new Set<string>();
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

    await this.spawnCall({
      role: 'orchestrator',
      description: `A new workstream was created. Goal: ${input.goal}. Get it planned and executed.`,
      workstreamId: ws.id,
      parentRunId: input.parentRunId,
      originMessageId: input.originMessageId,
    });
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

    // This orchestrator pass is now starting, so it no longer counts as the
    // "pending" one — a child finishing after this may legitimately queue a
    // fresh pass to surface its result.
    if (run.role === 'orchestrator' && run.workstreamId) {
      this.orchestratorQueued.delete(run.workstreamId);
    }

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

  /** After a child call finishes, re-invoke the workstream orchestrator. */
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

    const reinvokes = (RUN_ROLES_THAT_REINVOKE as readonly string[]).includes(
      run.role,
    );
    if (!reinvokes || !run.workstreamId) return;

    const ws = await this.store.getWorkstream(run.workstreamId);
    if (!ws || !Store.isActiveStatus(ws.status)) return;

    const wsRuns = await this.store.listRunsForWorkstream(run.workstreamId);
    let reviews = await this.store.listReviews(run.workstreamId);

    // Reviewer finished without submit_review — retry once, then auto-approve the
    // plan so workers can run before the bench timeout expires.
    if (
      run.role === 'reviewer' &&
      run.status === 'done' &&
      !hasSuccessfulTool(run, 'submit_review')
    ) {
      const plan = await this.store.readPlan(run.workstreamId);
      const hasPlanReview = reviews.some((r) => r.stage === 'plan');
      if (plan && !hasPlanReview) {
        const failedReviewers = wsRuns.filter(
          (r) =>
            r.role === 'reviewer' &&
            r.status === 'done' &&
            !hasSuccessfulTool(r, 'submit_review'),
        ).length;
        if (failedReviewers <= 1) {
          await this.spawnCall({
            role: 'reviewer',
            description:
              'Your previous pass did not call submit_review. Read the plan with read_plan, ' +
              'then call submit_review now with stage "plan", severity, approved, and notes. ' +
              'Do not re-read the entire codebase.',
            workstreamId: run.workstreamId,
            parentRunId: run.id,
            originMessageId: run.originMessageId,
            complexity: 'high',
          });
          return;
        }
        await recordPlanReviewFallback(
          this.store,
          run.workstreamId,
          run.output,
        );
        reviews = await this.store.listReviews(run.workstreamId);
      }
    }

    // Approved plan review but no workers yet — start implementation without
    // waiting for another orchestrator pass (flash orchestrators often loop).
    if (
      run.role === 'reviewer' &&
      run.status === 'done' &&
      hasSuccessfulTool(run, 'submit_review')
    ) {
      const planReview = reviews
        .filter((r) => r.stage === 'plan')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .at(-1);
      const hasWorker = wsRuns.some((r) => r.role === 'worker');
      if (planReview?.approved && !hasWorker) {
        await this.spawnCall({
          role: 'worker',
          description:
            'Implement the approved plan in the local repo. Apply the source changes from the plan. ' +
            'Do not modify test files unless the plan explicitly requires it. Report BLOCKED if stuck.',
          workstreamId: run.workstreamId,
          parentRunId: run.id,
          originMessageId: run.originMessageId,
          complexity: 'medium',
        });
        return;
      }
    }

    if (wsRuns.length >= this.config.maxRunsPerWorkstream) {
      await this.store.updateWorkstream(run.workstreamId, {
        status: 'blocked',
        summary: `${ws.summary}\n\n[System] Hit the run cap (${this.config.maxRunsPerWorkstream}); pausing for human input.`.trim(),
      });
      await this.reply(
        `Workstream "${ws.title}" hit its automatic work limit and is paused. Send a note if you want me to continue or adjust course.`,
        run.workstreamId,
      );
      return;
    }

    // Stop when reviews keep rejecting or the workstream oscillates between
    // re-planning and re-reviewing without converging.
    const stall = detectConvergenceStall(wsRuns, reviews);
    if (stall) {
      const detail = convergenceStallMessage(stall);
      await this.store.updateWorkstream(run.workstreamId, {
        status: 'blocked',
        summary: `${ws.summary}\n\n[System] ${detail}`.trim(),
      });
      await this.reply(
        `Workstream "${ws.title}" paused: ${detail}`,
        run.workstreamId,
      );
      return;
    }

    // Stop thrashing when work calls keep producing nothing (e.g. a reviewer
    // that never submits a review) rather than burning the whole run budget.
    const unproductiveStreak = await trailingUnproductiveWorkRuns(
      wsRuns,
      this.store,
    );
    if (unproductiveStreak >= MAX_UNPRODUCTIVE_WORK_RUNS) {
      await this.store.updateWorkstream(run.workstreamId, {
        status: 'blocked',
        summary: `${ws.summary}\n\n[System] Paused after ${unproductiveStreak} consecutive work calls produced no usable result (e.g. a reviewer that never submitted a review). This usually means the model assigned to a role could not reliably drive its tools. Send a note to retry or reconfigure the role models.`.trim(),
      });
      await this.reply(
        `Workstream "${ws.title}" stalled: ${unproductiveStreak} calls in a row produced no usable result, so I've paused it. This often means the model assigned to a role isn't reliably using its tools — try stronger models or send a note to continue.`,
        run.workstreamId,
      );
      return;
    }

    // Coalesce: if a pass is already queued for this workstream, let it absorb
    // this result instead of stacking another orchestrator call.
    if (this.orchestratorQueued.has(run.workstreamId)) return;
    this.orchestratorQueued.add(run.workstreamId);

    await this.spawnCall({
      role: 'orchestrator',
      description: `${describeOutcome(run)}\n\nReview the workstream status and decide the next step.`,
      workstreamId: run.workstreamId,
      parentRunId: run.id,
      originMessageId: run.originMessageId,
    });
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
