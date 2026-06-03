import {
  generateText,
  type JSONSchema7,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  tool,
  type ToolSet,
} from 'ai';
import { emptyUsage, type ToolInvocation } from '../storage/types.js';
import { applyResultBudget } from '../storage/tool-results.js';
import type { ToolResultConfig } from '../config.js';
import type { Layout } from '../storage/layout.js';
import type { CallResult, ToolDef } from './types.js';

export interface ToolResultSpillContext {
  layout: Layout;
  runId: string;
  config: ToolResultConfig;
  onSpill?: (info: { tool: string; path: string; previewChars: number }) => void;
  getRunCharTotal: () => number;
  addRunChars: (n: number) => void;
}

export interface RunToolLoopOptions {
  /** A resolved AI SDK model (see resolveLanguageModel). */
  model: LanguageModel;
  system: string;
  /** The task / message that seeds the conversation. */
  userMessage: string;
  tools: ToolDef[];
  maxIterations: number;
  maxTokens?: number;
  /** Called whenever a tool finishes, for live observability. */
  onToolCall?: (invocation: ToolInvocation) => void;
  /** Spill large tool outputs to disk instead of feeding them to the model. */
  toolResultSpill?: ToolResultSpillContext;
}

/** Cache-creation tokens live in provider metadata, not the normalized usage. */
function cacheCreationTokens(metadata: unknown): number {
  const anthropic = (metadata as { anthropic?: { cacheCreationInputTokens?: number } } | undefined)
    ?.anthropic;
  return anthropic?.cacheCreationInputTokens ?? 0;
}

/**
 * Runs a single LLM "call" as an AI SDK tool-use loop: the model is invoked
 * repeatedly, executing any tools it requests, until it produces a final text
 * answer or hits the iteration ceiling. Works across every Zen provider shape
 * (Anthropic Messages, OpenAI Responses, Google, OpenAI-compatible chat).
 */
export async function runToolLoop(
  opts: RunToolLoopOptions,
): Promise<CallResult> {
  const {
    model,
    system,
    userMessage,
    tools,
    maxIterations,
    maxTokens = 4096,
    onToolCall,
    toolResultSpill,
  } = opts;

  const toolCalls: ToolInvocation[] = [];
  let toolIndex = 0;

  const sdkTools: ToolSet = {};
  for (const def of tools) {
    sdkTools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema as JSONSchema7),
      async execute(input) {
        const args = (input ?? {}) as Record<string, unknown>;
        const at = new Date().toISOString();
        try {
          const rawOutput = await def.handler(args);
          let output = rawOutput || '(no output)';
          let spillPath: string | undefined;

          if (toolResultSpill) {
            const index = toolIndex++;
            const budget = await applyResultBudget({
              layout: toolResultSpill.layout,
              runId: toolResultSpill.runId,
              index,
              toolName: def.name,
              body: output,
              maxPerInvocation: toolResultSpill.config.maxCharsPerInvocation,
              maxPerRun: toolResultSpill.config.maxCharsPerRun,
              runTotalChars: toolResultSpill.getRunCharTotal(),
            });
            output = budget.output;
            spillPath = budget.spillPath;
            toolResultSpill.addRunChars(budget.runTotalChars - toolResultSpill.getRunCharTotal());
            if (spillPath) {
              toolResultSpill.onSpill?.({
                tool: def.name,
                path: spillPath,
                previewChars: output.length,
              });
            }
          }

          const invocation: ToolInvocation = {
            name: def.name,
            input: args,
            output,
            at,
            ...(spillPath ? { spillPath } : {}),
          };
          toolCalls.push(invocation);
          onToolCall?.(invocation);
          return invocation.output;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const output = `Error: ${message}`;
          const invocation: ToolInvocation = {
            name: def.name,
            input: args,
            output,
            error: message,
            at,
          };
          toolCalls.push(invocation);
          onToolCall?.(invocation);
          // Feed the error back to the model instead of aborting the call.
          return output;
        }
      },
    });
  }

  const messages: ModelMessage[] = [{ role: 'user', content: userMessage }];

  const result = await generateText({
    model,
    system,
    messages,
    tools: tools.length > 0 ? sdkTools : undefined,
    maxOutputTokens: maxTokens,
    stopWhen: stepCountIs(maxIterations),
  });

  const usage = emptyUsage();
  const cacheRead = result.totalUsage.cachedInputTokens ?? 0;
  usage.inputTokens = Math.max(0, (result.totalUsage.inputTokens ?? 0) - cacheRead);
  usage.outputTokens = result.totalUsage.outputTokens ?? 0;
  usage.cacheReadInputTokens = cacheRead;
  usage.requests = result.steps.length;
  for (const step of result.steps) {
    usage.cacheCreationInputTokens += cacheCreationTokens(step.providerMetadata);
  }

  const truncated = result.finishReason === 'tool-calls';

  return { text: result.text.trim(), toolCalls, usage, truncated };
}
