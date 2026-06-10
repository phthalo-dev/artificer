import { toolCallSignature } from '../llm/loop-detection.js';
import type { RunRecord } from '../storage/types.js';

/** Identical tool+args repeated this many times across worker runs triggers escalation. */
export const MAX_CROSS_RUN_IDENTICAL_TOOLS = 5;

export interface CrossRunRepetition {
  toolName: string;
  count: number;
}

/**
 * Detect trailing identical tool invocations across consecutive worker runs.
 * Catches thrash that within-call loop detection misses (separate dispatches).
 */
export function detectCrossRunToolRepetition(
  runs: RunRecord[],
  threshold = MAX_CROSS_RUN_IDENTICAL_TOOLS,
): CrossRunRepetition | null {
  const workerRuns = runs
    .filter((r) => r.role === 'worker' && (r.status === 'done' || r.status === 'failed'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let lastSig = '';
  let lastTool = '';
  let count = 0;

  for (const run of workerRuns) {
    for (const inv of run.toolCalls) {
      if (inv.error) continue;
      const sig = `${inv.name}:${toolCallSignature(inv.input)}`;
      if (sig === lastSig) {
        count += 1;
        if (count >= threshold) {
          return { toolName: lastTool, count };
        }
      } else {
        lastSig = sig;
        lastTool = inv.name;
        count = 1;
      }
    }
  }
  return null;
}
