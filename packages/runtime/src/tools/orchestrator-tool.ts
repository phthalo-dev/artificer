import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import type { RoleName, WorkstreamStatus } from '../storage/types.js';
import { isModelTier } from '../engine/models.js';

const SPAWNABLE_ROLES: RoleName[] = ['planner', 'reviewer', 'worker', 'orchestrator'];

const WORKSTREAM_STATUSES: WorkstreamStatus[] = [
  'pending',
  'planning',
  'reviewing',
  'in_progress',
  'blocked',
  'done',
  'failed',
  'cancelled',
];

/** Build a compact status snapshot for one workstream. */
async function workstreamStatus(
  ctx: ToolContext,
  workstreamId: string,
): Promise<string> {
  const { store } = ctx.engine;
  const ws = await store.getWorkstream(workstreamId);
  if (!ws) return `Workstream ${workstreamId} not found.`;
  const tasks = await store.listTasks(workstreamId);
  const reviews = await store.listReviews(workstreamId);
  const plan = await store.readPlan(workstreamId);
  return JSON.stringify(
    {
      id: ws.id,
      title: ws.title,
      goal: ws.goal,
      status: ws.status,
      summary: ws.summary,
      hasPlan: plan !== null,
      tasks: tasks.map((t) => ({
        id: t.id,
        role: t.role,
        status: t.status,
        description: t.description,
        result: t.result,
      })),
      reviews: reviews.map((r) => ({
        target: r.target,
        approved: r.approved,
        stage: r.stage,
        severity: r.severity,
        notes: r.notes,
      })),
    },
    null,
    2,
  );
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
        'Query the current state of the system. Without a workstreamId, returns an overview of all workstreams. With a workstreamId, returns that workstream\'s full status, tasks, reviews, and whether a plan exists.',
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
          null,
          2,
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
            enum: SPAWNABLE_ROLES,
            description: 'The role of the call to spawn.',
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
              'Optional model power for this task based on how hard it is. Defaults to the role\'s tier.',
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
        const role = String(input.role) as RoleName;
        if (!SPAWNABLE_ROLES.includes(role)) {
          return `Error: role must be one of ${SPAWNABLE_ROLES.join(', ')}.`;
        }
        const workstreamId =
          (input.workstreamId as string | undefined) ?? run.workstreamId;
        const complexity = isModelTier(input.complexity)
          ? input.complexity
          : undefined;
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
        if (input.status) patch.status = String(input.status) as WorkstreamStatus;
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
            description: 'Optional tag filter; only memories with these tags are considered.',
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
        const limit =
          typeof input.limit === 'number' ? input.limit : undefined;
        const memories = await store.queryMemories(
          input.query ? String(input.query) : '',
          { tags, limit },
        );
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
          summary: { type: 'string', description: 'One-line gist used for recall.' },
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
            enum: ['note', 'document'],
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
          input.kind === 'document' || input.kind === 'note'
            ? input.kind
            : undefined;
        const memory = await store.addMemory({
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
  ];
}
