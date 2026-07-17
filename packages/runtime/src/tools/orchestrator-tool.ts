import path from 'node:path';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { findGitRepo } from '../engine/git-repo.js';
import { isRepoTaskMessage } from '../engine/task-intent.js';
import {
  plannerSpawnBlocked,
  reviewerSpawnBlocked,
} from '../engine/spawn-guards.js';
import type { WorkstreamStatus } from '../storage/types.js';
import { isModelTier } from '../engine/models.js';

const WORKSTREAM_STATUSES: WorkstreamStatus[] = [
  'pending',
  'planning',
  'reviewing',
  'in_progress',
  'paused_quota',
  'blocked',
  'done',
  'failed',
  'cancelled',
];

/** Most recent tasks/reviews surfaced in a status snapshot. */
const MAX_STATUS_TASKS = 12;
const MAX_STATUS_REVIEWS = 6;
/** Per-field caps so the snapshot stays small as a workstream accumulates runs. */
const MAX_RESULT_CHARS = 600;
const MAX_NOTES_CHARS = 1_000;

function clip(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (${text.length - max} more chars)`;
}

/**
 * Build a compact status snapshot for one workstream. Tasks and reviews are
 * capped to the most recent few with truncated bodies so the orchestrator's
 * context (and cost) does not grow without bound as the run count climbs — it
 * has the running summary for the older history.
 */
async function workstreamStatus(
  ctx: ToolContext,
  workstreamId: string,
): Promise<string> {
  const { store } = ctx.engine;
  const ws = await store.getWorkstream(workstreamId);
  if (!ws) return `Workstream ${workstreamId} not found.`;
  const allTasks = await store.listTasks(workstreamId);
  const allReviews = await store.listReviews(workstreamId);
  const plan = await store.readPlan(workstreamId);
  const workspaceDir = store.layout.workstreamWorkspace(workstreamId);
  const localRepoPath = await findGitRepo(workspaceDir);

  const tasks = allTasks.slice(-MAX_STATUS_TASKS);
  const reviews = allReviews.slice(-MAX_STATUS_REVIEWS);

  return JSON.stringify({
    id: ws.id,
    title: ws.title,
    goal: ws.goal,
    status: ws.status,
    summary: ws.summary,
    repoUrl: ws.repoUrl,
    baseCommit: ws.baseCommit,
    localRepoReady: localRepoPath !== undefined,
    cloneLocation: localRepoPath
      ? path.relative(workspaceDir, localRepoPath) || '.'
      : undefined,
    hasPlan: plan !== null,
    taskCount: allTasks.length,
    omittedTasks: Math.max(0, allTasks.length - tasks.length),
    tasks: tasks.map((t) => ({
      id: t.id,
      role: t.role,
      status: t.status,
      description: clip(t.description, MAX_RESULT_CHARS),
      result: clip(t.result, MAX_RESULT_CHARS),
    })),
    reviews: reviews.map((r) => ({
      target: r.target,
      approved: r.approved,
      stage: r.stage,
      severity: r.severity,
      notes: clip(r.notes, MAX_NOTES_CHARS),
    })),
  });
}

/**
 * The orchestrator tool set: the shared primitive every call can use to query
 * the system and to spawn new calls, enabling arbitrarily deep hierarchies.
 */
export function createOrchestratorTools(ctx: ToolContext): ToolDef[] {
  const { engine, run } = ctx;
  const { store } = engine;

  return [
    {
      name: 'get_status',
      description:
        "Query the current state of the system. Without a workstreamId, returns an overview of all workstreams. With a workstreamId, returns that workstream's full status, tasks, reviews, and whether a plan exists.",
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: {
            type: 'string',
            description: 'Optional workstream id to inspect in detail.',
          },
        },
      },
      handler: async (input) => {
        if (run.role === 'communicator' && isRepoTaskMessage(run.task)) {
          return (
            'Error: For repo/SWE tasks, call start_workstream once with repoUrl and baseCommit, ' +
            'then reply. Do not poll get_status during intake.'
          );
        }
        if (input.workstreamId) {
          return workstreamStatus(ctx, String(input.workstreamId));
        }
        const all = await store.listWorkstreams();
        return JSON.stringify(
          all.map((ws) => ({
            id: ws.id,
            title: ws.title,
            status: ws.status,
            summary: ws.summary,
          })),
        );
      },
    },
    {
      name: 'invoke_call',
      description:
        'Spawn a new focused call to do a piece of work. Use role "planner" to produce a plan, "worker" to implement a single file or unit, "reviewer" to review work, or "orchestrator" to delegate a sub-stream. Optionally set "complexity" to choose the model power for this specific task (low = simple/cheap, high = hard reasoning); omit it to use the role default. When the spawned call finishes, the orchestrator for this workstream is automatically re-invoked with the result.',
      inputSchema: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            description:
              'The role of the call to spawn. Built-in roles: planner, worker, reviewer, orchestrator. Custom roles defined in agent/roles/ are also available.',
          },
          description: {
            type: 'string',
            description:
              'The task for the spawned call. Be specific; a worker should target a single file or unit.',
          },
          complexity: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description:
              "Optional model power for this task based on how hard it is. Defaults to the role's tier.",
          },
          workstreamId: {
            type: 'string',
            description:
              'Workstream the call belongs to. Defaults to the current workstream.',
          },
        },
        required: ['role', 'description'],
      },
      handler: async (input) => {
        const role = String(input.role);
        const availableRoles = engine.listRoles();
        if (!availableRoles.includes(role)) {
          return `Error: unknown role "${role}". Available roles: ${availableRoles.join(', ')}.`;
        }
        const workstreamId =
          (input.workstreamId as string | undefined) ?? run.workstreamId;
        const complexity = isModelTier(input.complexity)
          ? input.complexity
          : undefined;

        if (workstreamId && role === 'planner') {
          const blocked = await plannerSpawnBlocked(store, workstreamId);
          if (blocked) return `Error: ${blocked}`;
        }

        if (workstreamId && role === 'reviewer') {
          const stage = String(input.description).toLowerCase().includes('plan')
            ? 'plan'
            : 'work';
          const blocked = await reviewerSpawnBlocked(
            store,
            workstreamId,
            stage,
          );
          if (blocked) return `Error: ${blocked}`;
        }

        if (workstreamId && (role === 'worker' || role === 'reviewer')) {
          const ws = await store.getWorkstream(workstreamId);
          if (ws?.repoUrl) {
            const workspaceDir = store.layout.workstreamWorkspace(workstreamId);
            const localRepo = await findGitRepo(workspaceDir);
            if (!localRepo) {
              return (
                'Error: This workstream requires a local git repository in the workspace before ' +
                `${role} work. Spawn a planner to clone ${ws.repoUrl}` +
                (ws.baseCommit ? ` and checkout ${ws.baseCommit}` : '') +
                ', then write_plan.'
              );
            }
          }
        }

        const result = await engine.spawnCall({
          role,
          description: String(input.description),
          workstreamId,
          parentRunId: run.id,
          originMessageId: run.originMessageId,
          complexity,
        });
        return `Spawned ${role} call ${result.runId}${
          result.taskId ? ` (task ${result.taskId})` : ''
        }. It will run asynchronously and re-invoke the orchestrator on completion.`;
      },
    },
    {
      name: 'update_status',
      description:
        "Update a workstream's status and/or its running summary. Use this to record progress and decisions so future calls have context.",
      inputSchema: {
        type: 'object',
        properties: {
          workstreamId: {
            type: 'string',
            description: 'Workstream to update. Defaults to the current one.',
          },
          status: {
            type: 'string',
            enum: WORKSTREAM_STATUSES,
            description: 'New status, if changing.',
          },
          summary: {
            type: 'string',
            description: 'Replacement running summary, if updating.',
          },
        },
      },
      handler: async (input) => {
        const workstreamId =
          (input.workstreamId as string | undefined) ?? run.workstreamId;
        if (!workstreamId) return 'Error: no workstream to update.';
        const patch: { status?: WorkstreamStatus; summary?: string } = {};
        if (input.status)
          patch.status = String(input.status) as WorkstreamStatus;
        if (typeof input.summary === 'string') patch.summary = input.summary;
        const updated = await store.updateWorkstream(workstreamId, patch);
        if (!updated) return `Error: workstream ${workstreamId} not found.`;
        engine.emit({
          kind: 'workstream',
          at: new Date().toISOString(),
          data: updated,
        });
        return `Updated workstream ${workstreamId} (status: ${updated.status}).`;
      },
    },
    {
      name: 'query_memories',
      description:
        "Search the agent's long-term memory for relevant notes. Returns the top matches only. Leave query empty to list recent memories.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional tag filter; only memories with these tags are considered.',
          },
          limit: {
            type: 'number',
            description: 'Max memories to return (default 5).',
          },
        },
      },
      handler: async (input) => {
        const tags = Array.isArray(input.tags)
          ? (input.tags as unknown[]).map(String)
          : undefined;
        const limit = typeof input.limit === 'number' ? input.limit : undefined;
        const query = input.query ? String(input.query) : '';
        let memories = engine.identity
          ? await engine.identity.queryMemories(query, limit)
          : await store.queryMemories(query, { tags, limit });
        if (engine.identity && tags) {
          memories = memories.filter((m) =>
            tags.some((t) => m.tags.includes(t)),
          );
        }
        if (memories.length === 0) return '(no memories)';
        return memories
          .map((m) => {
            const head = m.title ?? m.content.slice(0, 60);
            const tagStr = m.tags.length ? ` [${m.tags.join(', ')}]` : '';
            const src = m.source ? ` (source: ${m.source})` : '';
            return `- ${head}${tagStr}${src}\n  ${m.content}`;
          })
          .join('\n\n');
      },
    },
    {
      name: 'add_memory',
      description:
        'Save a durable note to long-term memory (a decision, a fact, a preference, something learned). Give it a title, tags, and a source when you can.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The note to remember.' },
          title: { type: 'string', description: 'Short label for the memory.' },
          summary: {
            type: 'string',
            description: 'One-line gist used for recall.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for retrieval.',
          },
          source: {
            type: 'string',
            description: 'Where it came from: a URL, or "conversation".',
          },
          kind: {
            type: 'string',
            enum: ['note', 'document', 'preference'],
            description: 'Optional kind of memory.',
          },
        },
        required: ['content'],
      },
      handler: async (input) => {
        const tags = Array.isArray(input.tags)
          ? (input.tags as unknown[]).map(String)
          : [];
        const kind =
          input.kind === 'document' ||
          input.kind === 'note' ||
          input.kind === 'preference'
            ? input.kind
            : undefined;
        const memStore = engine.identity ?? store;
        const memory = await memStore.addMemory({
          content: String(input.content),
          tags,
          title: input.title ? String(input.title) : undefined,
          summary: input.summary ? String(input.summary) : undefined,
          source: input.source ? String(input.source) : undefined,
          kind,
        });
        return `Saved to memory (${memory.id}).`;
      },
    },
    {
      name: 'record_finding',
      description:
        'Record a durable finding on the workstream blackboard so later roles ' +
        'read it instead of re-investigating from scratch: a root cause, a key ' +
        'file/symbol, the exact test command, or a confirmed dead end. One ' +
        'concrete fact per call.',
      inputSchema: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            description: 'The finding — one concrete, durable fact.',
          },
          file: {
            type: 'string',
            description: 'The file or area it concerns, when applicable.',
          },
        },
        required: ['note'],
      },
      handler: async (input) => {
        if (!run.workstreamId) {
          return 'Error: findings can only be recorded inside a workstream.';
        }
        const finding = await store.createFinding({
          workstreamId: run.workstreamId,
          role: run.role,
          note: String(input.note),
          file: input.file ? String(input.file) : undefined,
        });
        return `Recorded finding (${finding.id}).`;
      },
    },
  ];
}
