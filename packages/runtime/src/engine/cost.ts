import {
  emptyUsage,
  type RoleName,
  type RunRecord,
  type TokenUsage,
} from '../storage/types.js';
import { costForUsage } from './pricing.js';

/** Aggregated usage plus derived cost across a set of runs. */
export interface UsageSummary extends TokenUsage {
  /** Number of runs (LLM calls) included. */
  runs: number;
  costUsd: number;
}

export function emptySummary(): UsageSummary {
  return { ...emptyUsage(), runs: 0, costUsd: 0 };
}

function addRun(summary: UsageSummary, run: RunRecord): UsageSummary {
  const u = run.usage ?? emptyUsage();
  summary.inputTokens += u.inputTokens;
  summary.outputTokens += u.outputTokens;
  summary.cacheCreationInputTokens += u.cacheCreationInputTokens;
  summary.cacheReadInputTokens += u.cacheReadInputTokens;
  summary.requests += u.requests;
  summary.runs += 1;
  summary.costUsd += costForUsage(run.model, u);
  return summary;
}

export function summarize(runs: RunRecord[]): UsageSummary {
  const summary = emptySummary();
  for (const run of runs) addRun(summary, run);
  summary.costUsd = Math.round(summary.costUsd * 1_000_000) / 1_000_000;
  return summary;
}

/** Group runs by a key (skipping runs with no key) and summarize each group. */
export function groupBy(
  runs: RunRecord[],
  keyOf: (run: RunRecord) => string | undefined,
): Record<string, UsageSummary> {
  const groups: Record<string, UsageSummary> = {};
  for (const run of runs) {
    const key = keyOf(run);
    if (key === undefined) continue;
    groups[key] ??= emptySummary();
    addRun(groups[key], run);
  }
  for (const key of Object.keys(groups)) {
    groups[key].costUsd =
      Math.round(groups[key].costUsd * 1_000_000) / 1_000_000;
  }
  return groups;
}

export function summarizeByRole(
  runs: RunRecord[],
): Record<string, UsageSummary> {
  return groupBy(runs, (r) => r.role as RoleName);
}

export interface RunNode {
  run: RunRecord;
  /** Usage for this call only. */
  self: UsageSummary;
  /** Usage for this call plus all descendants. */
  cumulative: UsageSummary;
  children: RunNode[];
}

function mergeInto(target: UsageSummary, source: UsageSummary): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.requests += source.requests;
  target.runs += source.runs;
  target.costUsd += source.costUsd;
}

/**
 * Builds the nested call tree from runs using parentRunId. Returns the root
 * nodes (runs whose parent is not part of the set), each annotated with its own
 * usage and the cumulative usage of its whole subtree.
 */
export function buildCallTree(runs: RunRecord[]): RunNode[] {
  const byId = new Map<string, RunNode>();
  for (const run of runs) {
    byId.set(run.id, {
      run,
      self: summarize([run]),
      cumulative: emptySummary(),
      children: [],
    });
  }

  const roots: RunNode[] = [];
  // Stable order by creation time so the tree reads chronologically.
  const ordered = [...byId.values()].sort((a, b) =>
    a.run.createdAt.localeCompare(b.run.createdAt),
  );
  for (const node of ordered) {
    const parentId = node.run.parentRunId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const computeCumulative = (node: RunNode): UsageSummary => {
    const total = emptySummary();
    mergeInto(total, node.self);
    for (const child of node.children) {
      mergeInto(total, computeCumulative(child));
    }
    total.costUsd = Math.round(total.costUsd * 1_000_000) / 1_000_000;
    node.cumulative = total;
    return total;
  };
  for (const root of roots) computeCumulative(root);

  return roots;
}
