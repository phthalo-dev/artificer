import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { readSpilledResult, resolveSpillPath } from '../storage/tool-results.js';

export function createToolResultReadTools(ctx: ToolContext): ToolDef[] {
  const { engine, run } = ctx;
  const layout = engine.store.layout;

  return [
    {
      name: 'read_tool_result',
      description:
        'Read a spilled tool result from disk. Use spill_key from a [spilled ...] preview. Supports optional line offset/limit.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: {
            type: 'string',
            description: 'Run id that produced the spill. Defaults to the current run.',
          },
          spill_key: {
            type: 'string',
            description: 'Spill file key, e.g. "0-run_shell.txt".',
          },
          offset: {
            type: 'number',
            description: '0-based line offset into the spilled file.',
          },
          limit: {
            type: 'number',
            description: 'Max lines to return from offset.',
          },
        },
        required: ['spill_key'],
      },
      handler: async (input) => {
        const spillKey = String(input.spill_key ?? '').trim();
        if (!spillKey) return 'Error: spill_key is required.';

        const runId = input.run_id ? String(input.run_id) : run.id;
        const offset =
          typeof input.offset === 'number' && input.offset >= 0 ? input.offset : 0;
        const limit =
          typeof input.limit === 'number' && input.limit > 0 ? input.limit : undefined;

        try {
          resolveSpillPath(layout, runId, spillKey);
        } catch (err) {
          return `Error: ${(err as Error).message}`;
        }

        try {
          return await readSpilledResult(layout, runId, spillKey, offset, limit);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('ENOENT')) {
            return `Error: spill "${spillKey}" not found for run ${runId}.`;
          }
          return `Error: ${message}`;
        }
      },
    },
  ];
}
