import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import type { ArtificerTool, ToolDefinition } from './types.js';

export function defineTool<TInput = Record<string, unknown>>(
  definition: ToolDefinition<TInput>,
): ArtificerTool<TInput> {
  return {
    name: definition.name,
    definition,
    toToolDef(ctx: ToolContext): ToolDef {
      return {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.input,
        handler: (input) =>
          Promise.resolve(definition.execute(input as TInput, ctx)).then(String),
      };
    },
  };
}
