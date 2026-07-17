import type { RunRecord, UsageSummary } from './api/types';
import { costForRun } from './cost';

export function summarizeByRoute(
  runs: RunRecord[],
): Record<string, UsageSummary> {
  const groups: Record<string, UsageSummary> = {};
  for (const run of runs) {
    const key = run.routeProfileId ?? 'primary';
    const g = groups[key] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requests: 0,
      runs: 0,
      costUsd: 0,
    };
    g.inputTokens += run.usage.inputTokens;
    g.outputTokens += run.usage.outputTokens;
    g.cacheCreationInputTokens += run.usage.cacheCreationInputTokens;
    g.cacheReadInputTokens += run.usage.cacheReadInputTokens;
    g.requests += run.usage.requests;
    g.runs += 1;
    g.costUsd += costForRun(run);
    groups[key] = g;
  }
  for (const key of Object.keys(groups)) {
    groups[key].costUsd =
      Math.round(groups[key].costUsd * 1_000_000) / 1_000_000;
  }
  return groups;
}
