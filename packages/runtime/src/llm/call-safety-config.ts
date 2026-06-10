export interface LoopDetectionConfig {
  softThreshold: number;
  hardThreshold: number;
}

export interface MistakeTrackerConfig {
  maxConsecutiveMistakes: number;
}

export interface WithinCallContextConfig {
  maxToolResultChars: number;
  maxTotalTextChars: number;
  outdatedReadInvalidation: boolean;
}

export interface CallSafetyConfig {
  loopDetection: LoopDetectionConfig;
  mistakeTracker: MistakeTrackerConfig;
  withinCallContext: WithinCallContextConfig;
  requestDiagnostics: boolean;
}

export const DEFAULT_CALL_SAFETY: CallSafetyConfig = {
  loopDetection: { softThreshold: 3, hardThreshold: 6 },
  mistakeTracker: { maxConsecutiveMistakes: 4 },
  withinCallContext: {
    maxToolResultChars: 50_000,
    maxTotalTextChars: 500_000,
    outdatedReadInvalidation: true,
  },
  requestDiagnostics: false,
};

export function loadCallSafetyConfig(
  env: NodeJS.ProcessEnv = process.env,
): CallSafetyConfig {
  return {
    loopDetection: {
      softThreshold: env.RUNTIME_LOOP_SOFT_THRESHOLD
        ? Number(env.RUNTIME_LOOP_SOFT_THRESHOLD)
        : DEFAULT_CALL_SAFETY.loopDetection.softThreshold,
      hardThreshold: env.RUNTIME_LOOP_HARD_THRESHOLD
        ? Number(env.RUNTIME_LOOP_HARD_THRESHOLD)
        : DEFAULT_CALL_SAFETY.loopDetection.hardThreshold,
    },
    mistakeTracker: {
      maxConsecutiveMistakes: env.RUNTIME_MISTAKE_MAX
        ? Number(env.RUNTIME_MISTAKE_MAX)
        : DEFAULT_CALL_SAFETY.mistakeTracker.maxConsecutiveMistakes,
    },
    withinCallContext: {
      maxToolResultChars: env.RUNTIME_WITHIN_CALL_MAX_TOOL_RESULT_CHARS
        ? Number(env.RUNTIME_WITHIN_CALL_MAX_TOOL_RESULT_CHARS)
        : DEFAULT_CALL_SAFETY.withinCallContext.maxToolResultChars,
      maxTotalTextChars: env.RUNTIME_WITHIN_CALL_MAX_TOTAL_CHARS
        ? Number(env.RUNTIME_WITHIN_CALL_MAX_TOTAL_CHARS)
        : DEFAULT_CALL_SAFETY.withinCallContext.maxTotalTextChars,
      outdatedReadInvalidation:
        env.RUNTIME_OUTDATED_READ_INVALIDATION !== 'false',
    },
    requestDiagnostics: env.RUNTIME_REQUEST_DIAGNOSTICS === 'true',
  };
}
