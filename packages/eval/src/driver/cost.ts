import type { RunNode, RuntimeClient } from './client.js';
import type { UsageSummary } from '../bench/types.js';

export interface InstanceCost {
  total: UsageSummary;
  byRole: Record<string, UsageSummary>;
  /** Full nested call tree for this message, for trajectory persistence. */
  tree: RunNode[];
}

/**
 * Pulls the cost/usage for the entire call tree rooted at one inbound message
 * (communicator -> orchestrator -> planner/worker/reviewer). This is the
 * efficiency signal per benchmark instance: tokens, USD, and run count.
 */
export async function collectCost(
  client: RuntimeClient,
  messageId: string,
): Promise<InstanceCost> {
  const cost = await client.messageCost(messageId);
  return { total: cost.total, byRole: cost.byRole, tree: cost.tree ?? [] };
}

const EMPTY: UsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  requests: 0,
  runs: 0,
  costUsd: 0,
};

/** Sums a set of usage summaries (e.g. suite totals across all instances). */
export function sumUsage(
  summaries: (UsageSummary | undefined)[],
): UsageSummary {
  const out: UsageSummary = { ...EMPTY };
  for (const s of summaries) {
    if (!s) continue;
    out.inputTokens += s.inputTokens;
    out.outputTokens += s.outputTokens;
    out.cacheCreationInputTokens += s.cacheCreationInputTokens;
    out.cacheReadInputTokens += s.cacheReadInputTokens;
    out.requests += s.requests;
    out.runs += s.runs;
    out.costUsd += s.costUsd;
  }
  out.costUsd = Math.round(out.costUsd * 1_000_000) / 1_000_000;
  return out;
}

/** Formats a USD amount with sensible precision for reports. */
export function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
