import { EventEmitter } from 'node:events';
import type { RuntimeConfig } from '../config.js';
import type { EngineApi, RuntimeEvent, SpawnCallInput } from '../context.js';
import { resolveLanguageModel } from '../llm/provider.js';
import { Store } from '../storage/store.js';
import type { Message, RunRecord, Workstream } from '../storage/types.js';
import { executeCall } from './call.js';
import { type ModelTier, type ModelTiers, pickModel } from './models.js';
import { Scheduler } from './scheduler.js';

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
    parentRunId?: string;
    originMessageId?: string;
  }): Promise<Workstream> {
    const ws = await this.store.createWorkstream({
      title: input.title,
      goal: input.goal,
      repoUrl: input.repoUrl,
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
    return this.getModelTiers();
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

    const reinvokes = (RUN_ROLES_THAT_REINVOKE as readonly string[]).includes(
      run.role,
    );
    if (!reinvokes || !run.workstreamId) return;

    const ws = await this.store.getWorkstream(run.workstreamId);
    if (!ws || !Store.isActiveStatus(ws.status)) return;

    const runCount = (await this.store.listRunsForWorkstream(run.workstreamId))
      .length;
    if (runCount >= this.config.maxRunsPerWorkstream) {
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

    const outcome =
      run.status === 'failed'
        ? `A ${run.role} call failed: ${run.error ?? 'unknown error'}.`
        : `A ${run.role} call finished. Result:\n${run.output ?? '(no output)'}`;

    await this.spawnCall({
      role: 'orchestrator',
      description: `${outcome}\n\nReview the workstream status and decide the next step.`,
      workstreamId: run.workstreamId,
      parentRunId: run.id,
      originMessageId: run.originMessageId,
    });
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
