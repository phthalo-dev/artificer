import { COMPACTABLE_TOOLS } from './context-compact.js';
import type { RunRecord } from '../storage/types.js';

const CLEARED = '[tool output pruned for summarization]';

/** Fractions of middle compactable invocations to clear, escalating on hard tier. */
export const PRUNE_FRACTIONS = [0, 0.1, 0.2, 0.5, 1] as const;

function serializeRun(run: RunRecord, clearIds: Set<string>): string {
  const lines = [`### Run ${run.id} [${run.role}]`];
  for (const inv of run.toolCalls) {
    const key = `${run.id}:${inv.at}:${inv.name}`;
    const compactable = COMPACTABLE_TOOLS.has(inv.name);
    const output =
      compactable && clearIds.has(key)
        ? CLEARED
        : inv.output.length > 2_000
          ? `${inv.output.slice(0, 2_000)}…`
          : inv.output;
    lines.push(`- ${inv.name}(${JSON.stringify(inv.input)}) → ${output}`);
  }
  return lines.join('\n');
}

/**
 * Serialize runs for the summarizer, progressively clearing middle compactable
 * tool outputs when input is still too large (Goose-style pre-summarize prune).
 */
export function serializeRunsForSummary(
  runs: RunRecord[],
  pruneLevel: number,
): string {
  const level = Math.min(Math.max(0, pruneLevel), PRUNE_FRACTIONS.length - 1);
  const fraction = PRUNE_FRACTIONS[level]!;

  const compactableKeys: string[] = [];
  for (const run of runs) {
    for (const inv of run.toolCalls) {
      if (COMPACTABLE_TOOLS.has(inv.name)) {
        compactableKeys.push(`${run.id}:${inv.at}:${inv.name}`);
      }
    }
  }

  const clearCount = Math.floor(compactableKeys.length * fraction);
  const start = Math.floor((compactableKeys.length - clearCount) / 2);
  const clearIds = new Set(compactableKeys.slice(start, start + clearCount));

  return runs.map((run) => serializeRun(run, clearIds)).join('\n\n');
}

export function pickPruneLevelForBudget(
  runs: RunRecord[],
  maxChars: number,
): number {
  for (let level = 0; level < PRUNE_FRACTIONS.length; level += 1) {
    if (serializeRunsForSummary(runs, level).length <= maxChars) {
      return level;
    }
  }
  return PRUNE_FRACTIONS.length - 1;
}
