import { runCodemode, startCodemodeCell } from '../codemode/runtime.js';
import type { CodemodeLimits } from '../config.js';
import type { ToolContext } from '../context.js';
import type { JsonSchema, ToolDef } from '../llm/types.js';

function formatSibling(def: ToolDef): string {
  const props = def.inputSchema.properties ?? {};
  const fields = Object.entries(props).map(([key, schema]) => {
    const s = schema as { type?: unknown; description?: unknown };
    const type = typeof s.type === 'string' ? s.type : 'unknown';
    const desc =
      typeof s.description === 'string' ? ` // ${s.description}` : '';
    return `  ${key}: ${type}${desc}`;
  });
  const body = fields.length > 0 ? `{\n${fields.join(',\n')}\n}` : '{}';
  return `tools.${def.name}(input: ${body}): Promise<string>\n  ${def.description}`;
}

function resolveSiblings(ctx: ToolContext, siblings: ToolDef[]): ToolDef[] {
  if (ctx.toolPlan) {
    return ctx.toolPlan.alwaysOn.filter(
      (t) => t.name !== 'execute' && t.name !== 'wait_execute',
    );
  }
  return siblings;
}

export function createExecuteTool(
  ctx: ToolContext,
  siblings: ToolDef[],
  limits: CodemodeLimits,
): ToolDef {
  const catalogSiblings = resolveSiblings(ctx, siblings);
  const catalog = catalogSiblings.map(formatSibling).join('\n\n');
  return {
    name: 'execute',
    description: `Run a small JavaScript program that calls this role's tools without a model round-trip per call. Write the body of an async function. \`return\` is the result. Call tools as \`await tools.read_file({ path: "..." })\`. Independent work: \`await Promise.all([...])\`. Missing tools throw (catchable). Nested execute is not available.

Guest helpers: \`await yield_control()\` pauses the cell; \`store(key, value)\` / \`load(key)\` are run-scoped JSON KV; \`notify(...)\` attaches messages to the result; \`exit()\` completes with null. Optional first line \`// @exec: {"yield_time_ms": N}\` is a soft segment budget. A result may be \`{ running: true, cellId }\` — resume with \`wait_execute\`.

Available tools:
${catalog}`,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Body of an async function. `return` is the result. Call tools as `await tools.read_file({ path: "..." })`. Independent work: `await Promise.all([...])`.',
        },
      },
      required: ['code'],
    } satisfies JsonSchema,
    handler: async (input) => {
      const resolved = resolveSiblings(ctx, siblings);
      const tools = resolved.map((s) => ({ name: s.name, handler: s.handler }));
      const code = String(input.code ?? '');
      if (ctx.codemodeCells) {
        const result = await startCodemodeCell({
          code,
          tools,
          limits,
          store: ctx.codemodeCells,
          runId: ctx.run.id,
          onToolCall: ctx.onToolCall,
        });
        return JSON.stringify(result);
      }
      const result = await runCodemode({
        code,
        tools,
        limits,
        onToolCall: ctx.onToolCall,
      });
      return JSON.stringify(result);
    },
  };
}
