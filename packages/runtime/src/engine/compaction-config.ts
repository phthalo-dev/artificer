export type CompactionTier = 'none' | 'soft' | 'hard';

export interface WithinCallCompactionConfig {
  enabled: boolean;
  /** Estimated in-call context chars above which LLM compaction runs in prepareStep. */
  softThresholdChars: number;
  /** Estimated in-call context chars above which aggressive prune precedes summarization. */
  hardThresholdChars: number;
  /** Messages kept verbatim at the tail of the tool loop after compaction. */
  keepRecentMessages: number;
  /** Max LLM compactions per call (mid-call threshold triggers). */
  maxCompactionsPerCall: number;
  /** Retry the call once after compacting when the provider reports context overflow. */
  overflowRetryEnabled: boolean;
}

export interface CompactionConfig {
  enabled: boolean;
  /** Estimated context chars above which soft compaction runs after a work-role call. */
  softThresholdChars: number;
  /** Estimated context chars above which progressive pruning precedes summarization. */
  hardThresholdChars: number;
  /** Completed runs kept in full detail after compaction. */
  keepRecentRuns: number;
  /** Minimum completed runs before compaction is considered. */
  minRunsBeforeCompact: number;
  /** Max chars fed to the summarizer model (pruned input). */
  maxSummaryInputChars: number;
  /** Max output tokens for the summarizer call. */
  summaryMaxTokens: number;
  withinCall: WithinCallCompactionConfig;
}

export const DEFAULT_WITHIN_CALL_COMPACTION: WithinCallCompactionConfig = {
  enabled: true,
  softThresholdChars: 350_000,
  hardThresholdChars: 450_000,
  keepRecentMessages: 8,
  maxCompactionsPerCall: 2,
  overflowRetryEnabled: true,
};

export const DEFAULT_COMPACTION: CompactionConfig = {
  enabled: true,
  softThresholdChars: 80_000,
  hardThresholdChars: 160_000,
  keepRecentRuns: 3,
  minRunsBeforeCompact: 4,
  maxSummaryInputChars: 120_000,
  summaryMaxTokens: 4_096,
  withinCall: DEFAULT_WITHIN_CALL_COMPACTION,
};

export function loadCompactionConfig(
  env: NodeJS.ProcessEnv = process.env,
): CompactionConfig {
  return {
    enabled: env.RUNTIME_COMPACTION_ENABLED !== 'false',
    softThresholdChars: env.RUNTIME_COMPACTION_SOFT_CHARS
      ? Number(env.RUNTIME_COMPACTION_SOFT_CHARS)
      : DEFAULT_COMPACTION.softThresholdChars,
    hardThresholdChars: env.RUNTIME_COMPACTION_HARD_CHARS
      ? Number(env.RUNTIME_COMPACTION_HARD_CHARS)
      : DEFAULT_COMPACTION.hardThresholdChars,
    keepRecentRuns: env.RUNTIME_COMPACTION_KEEP_RECENT
      ? Number(env.RUNTIME_COMPACTION_KEEP_RECENT)
      : DEFAULT_COMPACTION.keepRecentRuns,
    minRunsBeforeCompact: env.RUNTIME_COMPACTION_MIN_RUNS
      ? Number(env.RUNTIME_COMPACTION_MIN_RUNS)
      : DEFAULT_COMPACTION.minRunsBeforeCompact,
    maxSummaryInputChars: env.RUNTIME_COMPACTION_MAX_INPUT_CHARS
      ? Number(env.RUNTIME_COMPACTION_MAX_INPUT_CHARS)
      : DEFAULT_COMPACTION.maxSummaryInputChars,
    summaryMaxTokens: env.RUNTIME_COMPACTION_SUMMARY_MAX_TOKENS
      ? Number(env.RUNTIME_COMPACTION_SUMMARY_MAX_TOKENS)
      : DEFAULT_COMPACTION.summaryMaxTokens,
    withinCall: {
      enabled: env.RUNTIME_WITHIN_CALL_COMPACT_ENABLED !== 'false',
      softThresholdChars: env.RUNTIME_WITHIN_CALL_COMPACT_SOFT_CHARS
        ? Number(env.RUNTIME_WITHIN_CALL_COMPACT_SOFT_CHARS)
        : DEFAULT_WITHIN_CALL_COMPACTION.softThresholdChars,
      hardThresholdChars: env.RUNTIME_WITHIN_CALL_COMPACT_HARD_CHARS
        ? Number(env.RUNTIME_WITHIN_CALL_COMPACT_HARD_CHARS)
        : DEFAULT_WITHIN_CALL_COMPACTION.hardThresholdChars,
      keepRecentMessages: env.RUNTIME_WITHIN_CALL_COMPACT_KEEP_RECENT
        ? Number(env.RUNTIME_WITHIN_CALL_COMPACT_KEEP_RECENT)
        : DEFAULT_WITHIN_CALL_COMPACTION.keepRecentMessages,
      maxCompactionsPerCall: env.RUNTIME_WITHIN_CALL_COMPACT_MAX_PER_CALL
        ? Number(env.RUNTIME_WITHIN_CALL_COMPACT_MAX_PER_CALL)
        : DEFAULT_WITHIN_CALL_COMPACTION.maxCompactionsPerCall,
      overflowRetryEnabled: env.RUNTIME_OVERFLOW_RETRY_ENABLED !== 'false',
    },
  };
}

export function assessCompactionTier(
  estimatedChars: number,
  config: CompactionConfig,
): CompactionTier {
  if (!config.enabled) return 'none';
  if (estimatedChars >= config.hardThresholdChars) return 'hard';
  if (estimatedChars >= config.softThresholdChars) return 'soft';
  return 'none';
}
