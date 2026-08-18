import type { CodemodeLimits } from '../config.js';
import type { ToolContext } from '../context.js';
import type { JsonSchema, ToolDef } from '../llm/types.js';
import { runCodemode } from '../codemode/runtime.js';

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

export function createExecuteTool(
  ctx: ToolContext,
  siblings: ToolDef[],
  limits: CodemodeLimits,
): ToolDef {
  const catalog = siblings.map(formatSibling).join('\n\n');
  return {
    name: 'execute',
    description: `Run a small JavaScript program that calls this role's tools without a model round-trip per call. Write the body of an async function. \`return\` is the result. Call tools as \`await tools.read_file({ path: "..." })\`. Independent work: \`await Promise.all([...])\`. Missing tools throw (catchable). Nested execute is not available.

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
      const result = await runCodemode({
        code: String(input.code ?? ''),
        tools: siblings.map((s) => ({ name: s.name, handler: s.handler })),
        limits,
        onToolCall: ctx.onToolCall,
      });
      return JSON.stringify(result);
    },
  };
}
