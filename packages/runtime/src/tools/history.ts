import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

/** Recall tool over past run outcomes (planner/worker/reviewer/librarian calls). */
export function createHistoryTools(ctx: ToolContext): ToolDef[] {
  const { engine } = ctx;
  const { store } = engine;

  return [
    {
      name: 'search_history',
      description:
        'Search past run history (planner/worker/reviewer/librarian calls) by task and outcome. Returns the top matches only. Leave query empty to list the most recent runs.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text.' },
          role: {
            type: 'string',
            description:
              'Optional filter: only runs by this role (e.g. "worker").',
          },
          workstreamId: {
            type: 'string',
            description: 'Optional filter: only runs in this workstream.',
          },
          status: {
            type: 'string',
            enum: ['done', 'failed'],
            description: 'Optional filter: only runs with this outcome.',
          },
          limit: {
            type: 'number',
            description: 'Max runs to return (default 5, max 20).',
          },
        },
      },
      handler: async (input) => {
        const query = input.query ? String(input.query) : '';
        const role = typeof input.role === 'string' ? input.role : undefined;
        const workstreamId =
          typeof input.workstreamId === 'string'
            ? input.workstreamId
            : undefined;
        const status =
          input.status === 'done' || input.status === 'failed'
            ? input.status
            : undefined;
        const limit = typeof input.limit === 'number' ? input.limit : 5;

        const results = await store.searchHistory(query, {
          role,
          workstreamId,
          status,
          limit,
        });
        if (results.length === 0) return '(no run history)';
        return results
          .map((r) => {
            const location = r.workstreamId
              ? ` (workstream ${r.workstreamId}, ${r.status})`
              : ` (${r.status})`;
            const header = `- [${r.role}] ${r.taskExcerpt}${location}`;
            return r.outputExcerpt ? `${header}\n  ${r.outputExcerpt}` : header;
          })
          .join('\n\n');
      },
    },
  ];
}
