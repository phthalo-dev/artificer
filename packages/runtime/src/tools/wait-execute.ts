import { resumeCodemodeCell } from '../codemode/runtime.js';
import type { ToolContext } from '../context.js';
import type { JsonSchema, ToolDef } from '../llm/types.js';

/** Spec default when `wait_execute` omits `yield_time_ms`. */
export const WAIT_EXECUTE_DEFAULT_YIELD_MS = 10_000;

export function createWaitExecuteTool(ctx: ToolContext): ToolDef {
  return {
    name: 'wait_execute',
    description: `Resume a previously yielded execute cell. Pass the cellId from a running execute result. Optional yield_time_ms is a soft budget for this wait (default ${WAIT_EXECUTE_DEFAULT_YIELD_MS}). terminate: true discards the cell without waiting.`,
    inputSchema: {
      type: 'object',
      properties: {
        cellId: {
          type: 'string',
          description:
            'Id of a running execute cell returned by a prior execute or wait_execute.',
        },
        yield_time_ms: {
          type: 'number',
          description: `Soft wall-clock budget for this wait in milliseconds. Defaults to ${WAIT_EXECUTE_DEFAULT_YIELD_MS} if omitted.`,
        },
        terminate: {
          type: 'boolean',
          description:
            'Dispose the cell immediately instead of waiting for it to finish.',
        },
      },
      required: ['cellId'],
    } satisfies JsonSchema,
    handler: async (input) => {
      const cellId = String(input.cellId ?? '');
      const store = ctx.codemodeCells;
      if (!store || !cellId) {
        return JSON.stringify({
          ok: false,
          error: {
            kind: 'CellNotFound',
            message: cellId
              ? `no live codemode cell ${cellId}`
              : 'cellId is required',
          },
          toolCalls: [],
        });
      }

      const terminate = Boolean(input.terminate);
      const yieldTimeMs =
        input.yield_time_ms === undefined
          ? WAIT_EXECUTE_DEFAULT_YIELD_MS
          : Number(input.yield_time_ms);

      const result = await resumeCodemodeCell({
        store,
        runId: ctx.run.id,
        cellId,
        ...(terminate ? {} : { yieldTimeMs }),
        terminate,
      });
      return JSON.stringify(result);
    },
  };
}
