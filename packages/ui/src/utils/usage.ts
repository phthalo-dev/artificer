import type { RunRecord, TokenUsage, UsageSummary } from '../api/types';
import { costForRun } from '../cost';

/** Zeroed `UsageSummary` accumulator. */
export function emptyUsageSummary(): UsageSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    requests: 0,
    runs: 0,
    costUsd: 0,
  };
}

/** Total tokens across every usage layer (input, output, both caches). */
export function totalTokens(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens
  );
}

/** Run usage grouped by routing profile ("primary" when unprofiled). */
export function summarizeByRoute(
  runs: RunRecord[],
): Record<string, UsageSummary> {
  return summarizeRuns(runs, (run) => run.routeProfileId ?? 'primary');
}

/** Accumulate run usage into groups keyed by `keyOf(run)`, rounded to μ$. */
export function summarizeRuns<T extends string>(
  runs: RunRecord[],
  keyOf: (run: RunRecord) => T,
): Record<T, UsageSummary> {
  const groups: Record<string, UsageSummary> = {};
  for (const run of runs) {
    const key = keyOf(run);
    const g = (groups[key] ??= emptyUsageSummary());
    const u = run.usage;
    g.inputTokens += u.inputTokens;
    g.outputTokens += u.outputTokens;
    g.cacheCreationInputTokens += u.cacheCreationInputTokens;
    g.cacheReadInputTokens += u.cacheReadInputTokens;
    g.requests += u.requests;
    g.runs += 1;
    g.costUsd += costForRun(run);
  }
  for (const key of Object.keys(groups)) {
    groups[key].costUsd =
      Math.round(groups[key].costUsd * 1_000_000) / 1_000_000;
  }
  return groups as Record<T, UsageSummary>;
}
