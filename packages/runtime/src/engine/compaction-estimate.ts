import type { CompactionArtifact } from '../storage/types.js';
import type { RunRecord, Workstream } from '../storage/types.js';
import { COMPACTABLE_TOOLS } from './context-compact.js';

function invocationChars(inv: RunRecord['toolCalls'][number]): number {
  const outputLen = inv.output?.length ?? 0;
  const inputLen = JSON.stringify(inv.input ?? {}).length;
  return outputLen + inputLen + inv.name.length + 40;
}

function runChars(run: RunRecord): number {
  return run.task.length + run.toolCalls.reduce((n, inv) => n + invocationChars(inv), 0);
}

function completedRuns(runs: RunRecord[]): RunRecord[] {
  return runs
    .filter((r) => r.status === 'done' && r.toolCalls.length > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Runs that would be summarized (all but the trailing keepRecent window). */
export function runsToCompact(
  runs: RunRecord[],
  keepRecent: number,
): RunRecord[] {
  const completed = completedRuns(runs);
  if (completed.length <= keepRecent) return [];
  return completed.slice(0, completed.length - keepRecent);
}

/** Runs kept in the live digest after compaction. */
export function recentRunsForDigest(
  runs: RunRecord[],
  compaction: CompactionArtifact | null,
  keepRecent: number,
  maxRuns: number,
): RunRecord[] {
  const completed = completedRuns(runs);
  if (completed.length === 0) return [];

  if (compaction?.compactedThroughRunId) {
    const idx = completed.findIndex((r) => r.id === compaction.compactedThroughRunId);
    const after =
      idx >= 0 ? completed.slice(idx + 1) : completed.slice(-keepRecent);
    return after.slice(-maxRuns);
  }

  return completed.slice(-maxRuns);
}

/** Rough char estimate for whether cross-call compaction should run. */
export function estimateWorkstreamContextChars(input: {
  workstream: Pick<Workstream, 'goal' | 'summary' | 'title'>;
  plan: string | null;
  runs: RunRecord[];
  compaction: CompactionArtifact | null;
  keepRecent: number;
}): number {
  const { workstream, plan, runs, compaction, keepRecent } = input;
  let total =
    workstream.goal.length +
    workstream.summary.length +
    workstream.title.length +
    (plan?.length ?? 0) +
    (compaction?.summary.length ?? 0);

  const toCompact = runsToCompact(runs, keepRecent);
  for (const run of toCompact) {
    total += runChars(run);
  }

  const recent = recentRunsForDigest(runs, compaction, keepRecent, keepRecent);
  for (const run of recent) {
    total += runChars(run);
    for (const inv of run.toolCalls) {
      if (COMPACTABLE_TOOLS.has(inv.name)) {
        total += Math.min(inv.output.length, 400);
      }
    }
  }

  return total;
}
