import type { LanguageModel, ModelMessage } from 'ai';
import type { WithinCallCompactionConfig } from '../engine/compaction-config.js';
import type { CallSafetyConfig } from './call-safety-config.js';
import {
  completionReminderText,
  plannerWritePlanReminderText,
} from './completion.js';
import { createLoopDetectionState } from './loop-detection.js';
import { sanitizeMessagesForStep } from './message-sanitizer.js';
import type { LoopDetectionState } from './loop-detection.js';
import type { WorkerBrowseState } from './shell-browse-detection.js';
import {
  classifyStepFromToolResults,
  createMistakeTrackerState,
  recordStepOutcome,
  type MistakeTrackerState,
} from './mistake-tracker.js';
import {
  estimateRequestChars,
  summarizeStepRequest,
  type RequestDiagnosticsSummary,
} from './request-diagnostics.js';
import {
  assessWithinCallCompactionTier,
  compactMessagesForWithinCall,
} from './within-call-compact.js';

export type { MistakeTrackerState };

export interface StepHookContext {
  safety: CallSafetyConfig;
  loopState: LoopDetectionState;
  mistakeState: MistakeTrackerState;
  runId: string;
  pendingLoopWarning?: string;
  pendingCompletionReminder?: string;
  requireCompletionTool?: boolean;
  completionToolName?: string;
  completionReminderAtStart?: boolean;
  abortReason?: string;
  lastPreparedMessages?: ModelMessage[];
  log?: (line: string) => void;
  withinCallCompaction?: WithinCallCompactionConfig;
  summarizeModel?: LanguageModel;
  compactionMaxInputChars?: number;
  compactionSummaryMaxTokens?: number;
  taskContext?: string;
  withinCallCompactCount?: number;
  /** Planner calls must end with write_plan. */
  requireWritePlan?: boolean;
  plannerWritePlanNudgeStep?: number;
  plannerWritePlanNudgeInterval?: number;
  /** Worker calls must edit, not shell-browse indefinitely. */
  requireWorkerEdit?: boolean;
  workerBrowseState?: WorkerBrowseState;
  pendingWorkerBrowseWarning?: string;
}

function stepsIncludeTool(steps: unknown[], toolName: string): boolean {
  for (const step of steps) {
    const record = step as { toolCalls?: Array<{ toolName: string }> };
    if (record.toolCalls?.some((t) => t.toolName === toolName)) {
      return true;
    }
  }
  return false;
}

export interface PrepareStepOutcome {
  messages: ModelMessage[];
  abortReason?: string;
}

export function createStepHookContext(
  safety: CallSafetyConfig,
  runId: string,
): StepHookContext {
  return {
    safety,
    loopState: createLoopDetectionState(),
    mistakeState: createMistakeTrackerState(),
    runId,
  };
}

export async function runPrepareStep(
  ctx: StepHookContext,
  messages: ModelMessage[],
  stepNumber: number,
  steps: unknown[],
  system?: string,
): Promise<PrepareStepOutcome> {
  if (ctx.abortReason) return { messages, abortReason: ctx.abortReason };
  let next = messages;
  if (ctx.requireCompletionTool) {
    if (stepNumber === 0 && ctx.completionReminderAtStart) {
      next = [
        ...next,
        { role: 'user', content: completionReminderText() },
      ];
      ctx.completionReminderAtStart = false;
    }
    if (ctx.pendingCompletionReminder) {
      next = [...next, { role: 'user', content: ctx.pendingCompletionReminder }];
      ctx.pendingCompletionReminder = undefined;
    }
  }
  if (ctx.pendingLoopWarning) {
    next = [...next, { role: 'user', content: ctx.pendingLoopWarning }];
    ctx.pendingLoopWarning = undefined;
  }
  if (ctx.pendingWorkerBrowseWarning) {
    next = [...next, { role: 'user', content: ctx.pendingWorkerBrowseWarning }];
    ctx.pendingWorkerBrowseWarning = undefined;
  }
  const writePlanNudgeStep = ctx.plannerWritePlanNudgeStep ?? 4;
  const writePlanNudgeInterval = ctx.plannerWritePlanNudgeInterval ?? 4;
  if (
    ctx.requireWritePlan &&
    stepNumber >= writePlanNudgeStep &&
    (stepNumber - writePlanNudgeStep) % writePlanNudgeInterval === 0 &&
    !stepsIncludeTool(steps, 'write_plan')
  ) {
    next = [...next, { role: 'user', content: plannerWritePlanReminderText() }];
  }
  next = sanitizeMessagesForStep(next, {
    maxToolResultChars: ctx.safety.withinCallContext.maxToolResultChars,
    maxTotalTextChars: ctx.safety.withinCallContext.maxTotalTextChars,
    outdatedReadInvalidation: ctx.safety.withinCallContext.outdatedReadInvalidation,
  });

  const withinCall = ctx.withinCallCompaction;
  const compactCount = ctx.withinCallCompactCount ?? 0;
  if (
    withinCall?.enabled &&
    ctx.summarizeModel &&
    compactCount < withinCall.maxCompactionsPerCall
  ) {
    const estimatedChars = estimateRequestChars(next, system);
    const tier = assessWithinCallCompactionTier(estimatedChars, withinCall);
    if (tier !== 'none') {
      ctx.log?.(
        `within-call compaction (${tier}) at step ${stepNumber}, ~${estimatedChars} chars`,
      );
      next = await compactMessagesForWithinCall({
        messages: next,
        summarizeModel: ctx.summarizeModel,
        config: withinCall,
        maxInputChars: ctx.compactionMaxInputChars ?? 120_000,
        maxOutputTokens: ctx.compactionSummaryMaxTokens ?? 4_096,
        taskContext: ctx.taskContext,
        tier,
        maxTotalTextChars: ctx.safety.withinCallContext.maxTotalTextChars,
      });
      ctx.withinCallCompactCount = compactCount + 1;
    }
  }

  ctx.lastPreparedMessages = next;
  return { messages: next };
}

export function runOnStepFinish(
  ctx: StepHookContext,
  event: {
    stepNumber: number;
    toolResults: Array<{ output?: unknown; isError?: boolean }>;
    finishReason?: string;
  },
  system: string | undefined,
  onDiagnostics?: (summary: RequestDiagnosticsSummary) => void,
): void {
  const outcome = classifyStepFromToolResults(event.toolResults, event.finishReason);
  const { shouldAbort, reason } = recordStepOutcome(
    ctx.mistakeState,
    outcome,
    ctx.safety.mistakeTracker.maxConsecutiveMistakes,
  );

  if (shouldAbort && reason) {
    ctx.abortReason = reason;
    ctx.log?.(`mistake limit reached: ${reason}`);
  }

  if (ctx.safety.requestDiagnostics && onDiagnostics && ctx.lastPreparedMessages) {
    onDiagnostics(
      summarizeStepRequest(ctx.lastPreparedMessages, system, event.stepNumber),
    );
  }
}
