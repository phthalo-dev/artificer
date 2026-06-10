import { EventEmitter } from 'node:events';
import type { RuntimeConfig } from '../config.js';
import type { EngineApi, RuntimeEvent, SpawnCallInput } from '../context.js';
import { resolveLanguageModel } from '../llm/provider.js';
import { Store } from '../storage/store.js';
import type { Message, RunRecord, Workstream, WorkstreamPhase } from '../storage/types.js';
import { executeCall } from './call.js';
import { findGitRepo } from './git-repo.js';
import { hasMeaningfulPatch } from './patch-facts.js';
import {
  insufficientBalanceUserMessage,
  isInsufficientBalanceError,
} from '../llm/errors.js';
import {
  declareBlockedReason,
  runHasDeclareBlocked,
  runHasSuccessfulTool,
  runHasVerifiedDeclareDone,
  trailingPlannerNoWritePlan,
  trailingPlannerReviewerCycles,
  trailingRejectedReviewCount,
  trailingReviewerNoSubmit,
} from './convergence.js';
import { type ModelTier, type ModelTiers, pickModel } from './models.js';
import {
  cloneRoleTiers,
  getPreset,
  type ModelPreset,
} from './presets.js';
import { Scheduler } from './scheduler.js';
import type { RoleName } from '../storage/types.js';
import {
  MAX_PHASE_ITERATIONS,
  type WorkstreamAction,
  type WorkstreamFacts,
  nextWorkstreamAction,
} from './workstream-machine.js';
import { getAgentConfigForWorkstream } from '../tools/agent-definition.js';
import { shouldInvokePhaseOrchestrator } from './phase-orchestrator.js';
import { detectCrossRunToolRepetition } from './cross-run-loop.js';
import { maybeCompactWorkstream } from './compact-workstream.js';

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
  if (run.role === 'worker') {
    if (runHasDeclareBlocked(run)) return false;
    if (runHasVerifiedDeclareDone(run)) return false;
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
   * Given the runs recovered at startup, resumes execution for each
   * still-active workstream that had an interrupted call. Uses the state
   * machine to determine the next action. Returns the number resumed.
   */
  async resumeInterruptedWorkstreams(recovered: RunRecord[]): Promise<number> {
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

      const facts = await this.gatherFacts(workstreamId);
      if (!facts) continue;

      const action = nextWorkstreamAction(facts);
      await this.dispatchAction(workstreamId, action, run.originMessageId);
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

    const model = input.agentConfig
      ? this.modelForAgentConfig(input.agentConfig)
      : this.modelFor(input.role, input.complexity);

    const run = await this.store.createRun({
      role: input.role,
      task: input.description,
      workstreamId: input.workstreamId,
      taskId,
      parentRunId: input.parentRunId,
      originMessageId: input.originMessageId,
      model,
      agentConfigId: input.agentConfig?.id,
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

  /** Start execution for a workstream created via createDirectWorkstream. */
  async kickoffWorkstream(
    workstreamId: string,
    originMessageId: string,
  ): Promise<void> {
    const ws = await this.store.getWorkstream(workstreamId);
    if (!ws) throw new Error(`workstream ${workstreamId} not found`);

    if (this.config.singleLoop) {
      const facts = await this.gatherFacts(workstreamId);
      if (facts?.repoReady) {
        await this.store.updateWorkstream(workstreamId, {
          currentPhase: 'implementing',
          status: 'in_progress',
        });
      }
    }

    const facts = await this.gatherFacts(workstreamId);
    if (!facts) return;

    const action = nextWorkstreamAction(facts);
    await this.dispatchAction(workstreamId, action, originMessageId);
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

    const facts = await this.gatherFacts(ws.id);
    if (facts) {
      const action = nextWorkstreamAction(facts);
      await this.dispatchAction(ws.id, action, input.originMessageId, input.parentRunId);
    }
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

  /** Resolve the model id for a dynamic agent config. */
  private modelForAgentConfig(config: import('./agent-config.js').AgentConfig): string {
    if (config.modelOverride) {
      return config.modelOverride;
    }
    return this.config.models[config.modelTier];
  }

  /** Gather facts about a workstream for the state machine. */
  private async gatherFacts(workstreamId: string): Promise<WorkstreamFacts | null> {
    const ws = await this.store.getWorkstream(workstreamId);
    if (!ws) return null;

    const runs = await this.store.listRunsForWorkstream(workstreamId);
    const reviews = await this.store.listReviews(workstreamId);
    const plan = await this.store.readPlan(workstreamId);

    const workspaceDir = this.store.layout.workstreamWorkspace(workstreamId);
    const localRepo = await findGitRepo(workspaceDir);

    const sortedRuns = runs
      .filter((r) => r.status === 'done')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const sortedReviews = reviews
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const lastReview = sortedReviews.at(-1);
    const lastWorkerRun = [...sortedRuns].reverse().find((r) => r.role === 'worker');
    const lastReviewRun = [...sortedRuns].reverse().find((r) => r.role === 'reviewer');

    let workSinceLastReview = 0;
    if (lastReviewRun && lastWorkerRun) {
      if (lastWorkerRun.createdAt > lastReviewRun.createdAt) {
        workSinceLastReview = 1;
      }
    } else if (lastWorkerRun && sortedReviews.length === 0) {
      workSinceLastReview = 1;
    }

    const noSubmitStreak = trailingReviewerNoSubmit(runs);
    const lastReviewerNoSubmit =
      lastReviewRun !== undefined &&
      lastReviewRun.role === 'reviewer' &&
      !runHasSuccessfulTool(lastReviewRun, 'submit_review');

    const lastPlannerRun = [...sortedRuns]
      .reverse()
      .find((r) => r.role === 'planner' && (r.status === 'done' || r.status === 'failed'));
    const lastPlannerNoWritePlan =
      lastPlannerRun !== undefined &&
      !runHasSuccessfulTool(lastPlannerRun, 'write_plan');
    const plannerNoWriteStreak = trailingPlannerNoWritePlan(runs);

    const hasGitDiff = await hasMeaningfulPatch(workspaceDir);

    const patchPresent = runs.some(
      (r) =>
        r.role === 'worker' &&
        r.status === 'done' &&
        runHasVerifiedDeclareDone(r),
    );

    const lastWorkerOutcomeRun = [...runs]
      .filter((r) => r.role === 'worker' && (r.status === 'done' || r.status === 'failed'))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);

    const workerDeclaredBlocked =
      lastWorkerOutcomeRun !== undefined && runHasDeclareBlocked(lastWorkerOutcomeRun);
    const workerBlockedReason = lastWorkerOutcomeRun
      ? declareBlockedReason(lastWorkerOutcomeRun)
      : undefined;

    const phaseStartedAt = ws.phaseConfig?.startedAt;
    const currentPhase = ws.currentPhase ?? 'setup';
    const verificationComplete =
      currentPhase === 'verifying' &&
      phaseStartedAt !== undefined &&
      runs.some(
        (r) =>
          r.role === 'worker' &&
          r.status === 'done' &&
          runHasVerifiedDeclareDone(r) &&
          r.finishedAt !== undefined &&
          r.finishedAt >= phaseStartedAt,
      );

    const crossRunToolRepetition =
      currentPhase === 'implementing'
        ? detectCrossRunToolRepetition(runs)
        : null;

    return {
      hasRepoUrl: !!ws.repoUrl,
      repoReady: !!localRepo,
      planWritten: !!plan,
      patchPresent,
      hasGitDiff,
      requireGitDiffForDone: this.config.singleLoop
        ? this.config.requireGitDiffForDone
        : undefined,
      reviewCount: reviews.length,
      lastReviewApproved: lastReview?.approved,
      workSinceLastReview,
      totalRuns: runs.length,
      maxRuns: this.config.maxRunsPerWorkstream,
      currentPhase: ws.currentPhase ?? 'setup',
      iterationsInPhase: ws.phaseConfig?.iterationsInPhase ?? 0,
      maxPhaseIterations: ws.phaseConfig?.maxIterations ?? MAX_PHASE_ITERATIONS,
      consecutiveRejectedReviews: trailingRejectedReviewCount(reviews),
      plannerReviewerOscillationCycles: trailingPlannerReviewerCycles(runs),
      lastReviewerNoSubmit,
      consecutiveReviewerNoSubmit: noSubmitStreak,
      lastPlannerNoWritePlan,
      consecutivePlannerNoWritePlan: plannerNoWriteStreak,
      singleLoop: this.config.singleLoop,
      workerDeclaredBlocked,
      workerBlockedReason,
      verificationComplete,
      crossRunToolRepetition,
    };
  }

  /** Dispatch the next action from the state machine. */
  private async dispatchAction(
    workstreamId: string,
    action: WorkstreamAction,
    originMessageId?: string,
    parentRunId?: string,
  ): Promise<void> {
    switch (action.kind) {
      case 'setup':
        await this.store.updateWorkstream(workstreamId, { status: 'planning' });
        await this.spawnFsmDispatch(
          workstreamId,
          'planner',
          'Clone the repository into the workspace and checkout the base commit if specified. ' +
            'Then investigate the goal and write a plan with write_plan.',
          originMessageId,
          parentRunId,
        );
        break;

      case 'dispatch': {
        await this.store.updateWorkstream(workstreamId, {
          status: action.role === 'planner' ? 'planning' : action.role === 'reviewer' ? 'reviewing' : 'in_progress',
        });
        await this.spawnFsmDispatch(
          workstreamId,
          action.role,
          action.task,
          originMessageId,
          parentRunId,
        );
        break;
      }

      case 'phase_complete':
        await this.advanceAndContinue(workstreamId, action.nextPhase, originMessageId, parentRunId);
        break;

      case 'escalate':
        await this.handleEscalation(workstreamId, action.reason, originMessageId, parentRunId);
        break;

      case 'done':
        await this.store.updateWorkstream(workstreamId, { status: 'done' });
        await this.reply(
          `Workstream completed successfully.`,
          workstreamId,
        );
        break;

      case 'blocked':
        await this.store.updateWorkstream(workstreamId, {
          status: 'blocked',
          summary: `[System] ${action.reason}`,
        });
        await this.reply(
          `Workstream paused: ${action.reason}`,
          workstreamId,
        );
        break;
    }
  }

  /** Spawn a planner/worker/reviewer call from the state machine using phase agents. */
  private async spawnFsmDispatch(
    workstreamId: string,
    role: 'planner' | 'worker' | 'reviewer',
    task: string,
    originMessageId?: string,
    parentRunId?: string,
  ): Promise<void> {
    const ws = await this.store.getWorkstream(workstreamId);
    const agentDef = ws?.phaseConfig?.agentDefinitions?.find((d) => d.role === role);
    const agentConfig = agentDef
      ? await getAgentConfigForWorkstream(this.store, workstreamId, agentDef.agentConfigId)
      : undefined;

    let complexity: ModelTier | undefined = agentConfig?.modelTier;
    if (role === 'planner') {
      const runs = await this.store.listRunsForWorkstream(workstreamId);
      if (trailingPlannerNoWritePlan(runs) >= 1) {
        complexity = 'high';
      }
    }

    await this.spawnCall({
      role,
      description: task,
      workstreamId,
      originMessageId,
      parentRunId,
      complexity,
      agentConfig,
    });
  }

  /** Advance to the next phase. Skip orchestrator if phase is already complete. */
  private async advanceAndContinue(
    workstreamId: string,
    nextPhase: WorkstreamPhase,
    originMessageId?: string,
    parentRunId?: string,
  ): Promise<void> {
    await this.store.advancePhase(workstreamId, nextPhase);

    const facts = await this.gatherFacts(workstreamId);
    if (!facts) return;

    const action = nextWorkstreamAction(facts);

    if (action.kind === 'phase_complete') {
      await this.dispatchAction(workstreamId, action, originMessageId, parentRunId);
      return;
    }

    if (nextPhase === 'done' || nextPhase === 'verifying') {
      await this.dispatchAction(workstreamId, action, originMessageId, parentRunId);
      return;
    }

    const ws = await this.store.getWorkstream(workstreamId);
    const goal = ws?.goal ?? '';

    if (shouldInvokePhaseOrchestrator(goal, nextPhase)) {
      if (this.orchestratorQueued.has(workstreamId)) return;
      this.orchestratorQueued.add(workstreamId);

      await this.spawnCall({
        role: 'orchestrator',
        description:
          `[PHASE TRANSITION] The workstream has entered the "${nextPhase}" phase.\n\n` +
          'This is a complex task. Review the workstream status with get_status. Then:\n' +
          '1. Define specialized agents for this phase using define_agent (choose archetypes, tiers, and prompt extensions appropriate to the task).\n' +
          '2. Assign agents to roles using plan_agents.\n' +
          '3. Call update_status with a brief summary of your phase plan.\n' +
          '4. Stop — the state machine will execute the phase using your agents.\n\n' +
          'For simple subtasks within the phase, you can use default archetypes without customization.',
        workstreamId,
        originMessageId,
        parentRunId,
      });
      return;
    }

    await this.dispatchAction(workstreamId, action, originMessageId, parentRunId);
  }

  /** Handle an escalation by invoking the orchestrator. */
  private async handleEscalation(
    workstreamId: string,
    reason: string,
    originMessageId?: string,
    parentRunId?: string,
  ): Promise<void> {
    if (this.orchestratorQueued.has(workstreamId)) return;
    this.orchestratorQueued.add(workstreamId);

    await this.spawnCall({
      role: 'orchestrator',
      description:
        `[ESCALATION] ${reason}\n\n` +
        'Review the workstream status with get_status and decide how to proceed. ' +
        'You may adjust the approach, escalate to the user, or continue with a different strategy.',
      workstreamId,
      originMessageId,
      parentRunId,
    });
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

  /** After a child call finishes, dispatch the next action via state machine. */
  private async afterRun(run: RunRecord): Promise<void> {
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

    if (run.role === 'orchestrator' && run.workstreamId) {
      const ws = await this.store.getWorkstream(run.workstreamId);
      if (!ws || !Store.isActiveStatus(ws.status)) return;

      const facts = await this.gatherFacts(run.workstreamId);
      if (!facts) return;

      const action = nextWorkstreamAction(facts);
      await this.dispatchAction(
        run.workstreamId,
        action,
        run.originMessageId,
        run.id,
      );
      return;
    }

    const reinvokes = (RUN_ROLES_THAT_REINVOKE as readonly string[]).includes(
      run.role,
    );
    if (!reinvokes || !run.workstreamId) return;

    const ws = await this.store.getWorkstream(run.workstreamId);
    if (!ws || !Store.isActiveStatus(ws.status)) return;

    const wsRuns = await this.store.listRunsForWorkstream(run.workstreamId);

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

    await this.store.incrementPhaseIterations(run.workstreamId);

    if ((WORK_ROLES as readonly string[]).includes(run.role)) {
      await maybeCompactWorkstream({
        store: this.store,
        config: this.config,
        resolveModel: this.resolveModel,
        workstreamId: run.workstreamId,
      });
    }

    const facts = await this.gatherFacts(run.workstreamId);
    if (!facts) return;

    const action = nextWorkstreamAction(facts);
    await this.dispatchAction(
      run.workstreamId,
      action,
      run.originMessageId,
      run.id,
    );
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
