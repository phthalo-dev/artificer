import type { TokenUsage, ToolInvocation } from '../storage/types.js';

/** JSON Schema describing a tool's input object. */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * A tool the model can call. `handler` runs the side effect and returns a
 * string that is fed back to the model as the tool result.
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (input: Record<string, unknown>) => Promise<string>;
  needsApproval?: boolean | ((input: Record<string, unknown>) => boolean);
}

export interface CallResult {
  /** Final natural-language text produced by the call. */
  text: string;
  toolCalls: ToolInvocation[];
  /** Token usage summed across every model request in this call. */
  usage: TokenUsage;
  /** Whether the call stopped because it hit the iteration ceiling. */
  truncated: boolean;
}
