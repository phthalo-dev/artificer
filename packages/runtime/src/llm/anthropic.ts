import Anthropic from '@anthropic-ai/sdk';
import { emptyUsage, type TokenUsage, type ToolInvocation } from '../storage/types.js';
import type { CallResult, ToolDef } from './types.js';

/** Cache token fields are returned at runtime but absent from older SDK types. */
type UsageWithCache = Anthropic.Messages.Usage & {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

function accumulateUsage(
  totals: TokenUsage,
  usage: Anthropic.Messages.Usage,
): void {
  const u = usage as UsageWithCache;
  totals.inputTokens += u.input_tokens ?? 0;
  totals.outputTokens += u.output_tokens ?? 0;
  totals.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0;
  totals.cacheReadInputTokens += u.cache_read_input_tokens ?? 0;
  totals.requests += 1;
}

export interface RunToolLoopOptions {
  client: Anthropic;
  model: string;
  system: string;
  /** The task / message that seeds the conversation. */
  userMessage: string;
  tools: ToolDef[];
  maxIterations: number;
  maxTokens?: number;
  /** Called whenever a tool finishes, for live observability. */
  onToolCall?: (invocation: ToolInvocation) => void;
}

function textFromContent(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Runs a single LLM "call" as an Anthropic tool-use loop: the model is invoked
 * repeatedly, executing any tools it requests, until it produces a final text
 * answer or hits the iteration ceiling.
 */
export async function runToolLoop(
  opts: RunToolLoopOptions,
): Promise<CallResult> {
  const {
    client,
    model,
    system,
    userMessage,
    tools,
    maxIterations,
    maxTokens = 4096,
    onToolCall,
  } = opts;

  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const anthropicTools: Anthropic.Messages.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  const toolCalls: ToolInvocation[] = [];
  const usage = emptyUsage();
  let finalText = '';

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      messages,
    });

    accumulateUsage(usage, response.usage);
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      finalText = textFromContent(response.content);
      return { text: finalText, toolCalls, usage, truncated: false };
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const use of toolUses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      const tool = toolMap.get(use.name);
      const at = new Date().toISOString();

      if (!tool) {
        const output = `Error: unknown tool "${use.name}"`;
        const invocation: ToolInvocation = {
          name: use.name,
          input,
          output,
          error: output,
          at,
        };
        toolCalls.push(invocation);
        onToolCall?.(invocation);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: output,
          is_error: true,
        });
        continue;
      }

      try {
        const output = await tool.handler(input);
        const invocation: ToolInvocation = { name: use.name, input, output, at };
        toolCalls.push(invocation);
        onToolCall?.(invocation);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: output || '(no output)',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const output = `Error: ${message}`;
        const invocation: ToolInvocation = {
          name: use.name,
          input,
          output,
          error: message,
          at,
        };
        toolCalls.push(invocation);
        onToolCall?.(invocation);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: output,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { text: finalText, toolCalls, usage, truncated: true };
}
