import {
  generateText,
  type JSONSchema7,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  tool,
  type ToolSet,
} from 'ai';
import { emptyUsage, type ToolInvocation } from '../storage/types.js';
import { applyResultBudget } from '../storage/tool-results.js';
import type { ToolResultConfig } from '../config.js';
import type { Layout } from '../storage/layout.js';
import type { CompactionConfig } from '../engine/compaction-config.js';
import { DEFAULT_CALL_SAFETY, type CallSafetyConfig } from './call-safety-config.js';
import {
  completionReminderText,
  isBlockedStatusText,
  shellBrowseLoopWarningText,
  workerEditReminderText,
} from './completion.js';
import {
  WORKER_BLOCKED_TOOL,
  WORKER_DONE_TOOL,
  isWorkerTerminalTool,
} from './terminal-tools.js';
import { CallAbortedError, isContextLengthError } from './errors.js';
import {
  checkRepeatedToolCall,
  LOOP_WARNING_TEXT,
  toolCallSignature,
} from './loop-detection.js';
import {
  createWorkerBrowseState,
  DEFAULT_WORKER_BROWSE_CONFIG,
  recordWorkerToolCall,
  type WorkerBrowseConfig,
} from './shell-browse-detection.js';
import type { RequestDiagnosticsSummary } from './request-diagnostics.js';
import {
  createStepHookContext,
  runOnStepFinish,
  runPrepareStep,
  type StepHookContext,
} from './step-hooks.js';
import type { CallResult, ToolDef } from './types.js';
import { compactMessagesForWithinCall } from './within-call-compact.js';

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
  callSafety?: CallSafetyConfig;
  onDiagnostics?: (summary: RequestDiagnosticsSummary) => void;
  /** When true, the run is incomplete unless the completion tool was called. */
  requireCompletionTool?: boolean;
  /** Tool name that marks run completion (default declare_done). */
  completionToolName?: string;
  /** Cross-call compaction config (within-call tier used in prepareStep). */
  compaction?: CompactionConfig;
  /** Cheap model for mid-call / overflow compaction summaries. */
  summarizeModel?: LanguageModel;
  /** Original task text for within-call summarizer context. */
  taskContext?: string;
  /** Inject write_plan reminder when a planner explores without planning. */
  requireWritePlan?: boolean;
  plannerWritePlanNudgeStep?: number;
  plannerWritePlanNudgeInterval?: number;
  /** Nudge workers that shell-browse without editing (default on for worker calls). */
  workerShellBrowseGuard?: boolean;
  workerBrowseNudgeThreshold?: number;
  workerBrowseSameFileThreshold?: number;
}

/** Cache-creation tokens live in provider metadata, not the normalized usage. */
function cacheCreationTokens(metadata: unknown): number {
  const anthropic = (metadata as { anthropic?: { cacheCreationInputTokens?: number } } | undefined)
    ?.anthropic;
  return anthropic?.cacheCreationInputTokens ?? 0;
}

function configureHookContext(
  hookCtx: StepHookContext,
  opts: RunToolLoopOptions,
  completionToolName: string,
): void {
  if (opts.requireCompletionTool) {
    hookCtx.requireCompletionTool = true;
    hookCtx.completionToolName = completionToolName;
    hookCtx.completionReminderAtStart = true;
    if (opts.workerShellBrowseGuard !== false) {
      hookCtx.requireWorkerEdit = true;
      hookCtx.workerBrowseState = createWorkerBrowseState();
    }
  }
  if (opts.compaction?.withinCall.enabled && opts.summarizeModel) {
    hookCtx.withinCallCompaction = opts.compaction.withinCall;
    hookCtx.summarizeModel = opts.summarizeModel;
    hookCtx.compactionMaxInputChars = opts.compaction.maxSummaryInputChars;
    hookCtx.compactionSummaryMaxTokens = opts.compaction.summaryMaxTokens;
    hookCtx.taskContext = opts.taskContext ?? opts.userMessage;
    hookCtx.withinCallCompactCount = 0;
  }
  if (opts.requireWritePlan) {
    hookCtx.requireWritePlan = true;
    hookCtx.plannerWritePlanNudgeStep = opts.plannerWritePlanNudgeStep ?? 4;
    hookCtx.plannerWritePlanNudgeInterval = opts.plannerWritePlanNudgeInterval ?? 4;
  }
}

async function runToolLoopOnce(
  opts: RunToolLoopOptions,
  seedMessages: ModelMessage[],
): Promise<CallResult> {
  const {
    model,
    system,
    tools,
    maxIterations,
    maxTokens = 4096,
    onToolCall,
    toolResultSpill,
    onDiagnostics,
  } = opts;

  const toolCalls: ToolInvocation[] = [];
  let toolIndex = 0;
  const completionToolName = opts.completionToolName ?? WORKER_DONE_TOOL;
  let terminalToolCalled = false;
  let blockedToolCalled = false;

  const hookCtx = createStepHookContext(
    opts.callSafety ?? DEFAULT_CALL_SAFETY,
    toolResultSpill?.runId ?? 'unknown',
  );
  configureHookContext(hookCtx, opts, completionToolName);

  const sdkTools: ToolSet = {};
  for (const def of tools) {
    sdkTools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema as JSONSchema7),
      async execute(input) {
        const args = (input ?? {}) as Record<string, unknown>;
        const at = new Date().toISOString();

        const sig = toolCallSignature(args);
        const browseConfig: WorkerBrowseConfig = {
          nudgeThreshold:
            opts.workerBrowseNudgeThreshold ??
            DEFAULT_WORKER_BROWSE_CONFIG.nudgeThreshold,
          sameFileLoopThreshold:
            opts.workerBrowseSameFileThreshold ??
            DEFAULT_WORKER_BROWSE_CONFIG.sameFileLoopThreshold,
        };
        if (hookCtx.requireWorkerEdit && hookCtx.workerBrowseState) {
          const browseCheck = recordWorkerToolCall(
            hookCtx.workerBrowseState,
            def.name,
            args,
            browseConfig,
          );
          if (browseCheck.editNudge) {
            hookCtx.pendingWorkerBrowseWarning = workerEditReminderText();
          }
          if (browseCheck.sameFileLoopWarning) {
            hookCtx.pendingLoopWarning = shellBrowseLoopWarningText(
              browseCheck.loopTarget,
            );
          }
        }

        const check = checkRepeatedToolCall(
          hookCtx.loopState,
          def.name,
          sig,
          hookCtx.safety.loopDetection,
        );
        if (check.hardEscalation) {
          const output =
            'Error: Repeated identical tool call detected. Try a different approach.';
          const invocation: ToolInvocation = {
            name: def.name,
            input: args,
            output,
            error: output,
            at,
          };
          toolCalls.push(invocation);
          onToolCall?.(invocation);
          return output;
        }
        if (check.softWarning) {
          hookCtx.pendingLoopWarning = LOOP_WARNING_TEXT;
        }

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
          if (opts.requireCompletionTool && isWorkerTerminalTool(def.name) && !invocation.error) {
            terminalToolCalled = true;
            if (def.name === WORKER_BLOCKED_TOOL) {
              blockedToolCalled = true;
            }
          }
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
          return output;
        }
      },
    });
  }

  const messages: ModelMessage[] = [...seedMessages];

  try {
    const result = await generateText({
      model,
      system,
      messages,
      tools: tools.length > 0 ? sdkTools : undefined,
      maxOutputTokens: maxTokens,
      stopWhen: ({ steps }) => {
        if (steps.length >= maxIterations) return true;
        if (steps.length === 0) return false;
        const lastStep = steps[steps.length - 1];
        const hadToolCalls = (lastStep.toolCalls?.length ?? 0) > 0;
        if (opts.requireCompletionTool && !terminalToolCalled) {
          if (!hadToolCalls && isBlockedStatusText(lastStep.text ?? '')) {
            return true;
          }
          if (!hadToolCalls) {
            hookCtx.pendingCompletionReminder = completionReminderText();
          }
          return false;
        }
        return !hadToolCalls;
      },
      prepareStep: async ({ messages: stepMessages, stepNumber, steps }) => {
        const outcome = await runPrepareStep(
          hookCtx,
          stepMessages,
          stepNumber,
          steps,
          system,
        );
        if (outcome.abortReason) {
          throw new CallAbortedError(outcome.abortReason);
        }
        return { messages: outcome.messages };
      },
      onStepFinish: async (event) => {
        runOnStepFinish(hookCtx, event, system, onDiagnostics);
      },
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

    const truncated =
      result.finishReason === 'tool-calls' ||
      (opts.requireCompletionTool === true && !terminalToolCalled);

    let text = result.text.trim();
    if (opts.requireCompletionTool && !terminalToolCalled) {
      const prefix =
        `Run incomplete: call ${WORKER_DONE_TOOL} or ${WORKER_BLOCKED_TOOL} before finishing.`;
      text = text ? `${prefix}\n\n${text}` : prefix;
    }

    return { text, toolCalls, usage, truncated, blocked: blockedToolCalled };
  } catch (err) {
    if (err instanceof CallAbortedError) {
      return {
        text: `Call aborted: ${err.message}`,
        toolCalls,
        usage: emptyUsage(),
        truncated: true,
      };
    }
    throw err;
  }
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
  let seedMessages: ModelMessage[] = [{ role: 'user', content: opts.userMessage }];
  let retriedAfterCompaction = false;

  while (true) {
    try {
      const result = await runToolLoopOnce(opts, seedMessages);
      if (retriedAfterCompaction) {
        return { ...result, retriedAfterCompaction: true };
      }
      return result;
    } catch (err) {
      const withinCall = opts.compaction?.withinCall;
      if (
        !retriedAfterCompaction &&
        isContextLengthError(err) &&
        withinCall?.overflowRetryEnabled !== false &&
        withinCall?.enabled &&
        opts.summarizeModel
      ) {
        retriedAfterCompaction = true;
        seedMessages = await compactMessagesForWithinCall({
          messages: seedMessages,
          summarizeModel: opts.summarizeModel,
          config: withinCall,
          maxInputChars: opts.compaction?.maxSummaryInputChars ?? 120_000,
          maxOutputTokens: opts.compaction?.summaryMaxTokens ?? 4_096,
          taskContext: opts.taskContext ?? opts.userMessage,
          tier: 'overflow',
          maxTotalTextChars: opts.callSafety?.withinCallContext.maxTotalTextChars,
        });
        continue;
      }
      throw err;
    }
  }
}
