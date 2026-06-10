import type { Store } from '../storage/store.js';
import type { CompactionArtifact, RunRecord, ToolInvocation } from '../storage/types.js';
import { formatCompactionForContext } from './agentic-compact.js';
import { recentRunsForDigest } from './compaction-estimate.js';

export const CLEARED_TOOL_OUTPUT = '[Old tool result content cleared]';

export const COMPACTABLE_TOOLS = new Set([
  'read_file',
  'run_shell',
  'grep',
  'glob',
  'fetch_url',
]);

const CLIP_CHARS = 400;

function clip(text: string, max = CLIP_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function formatArgs(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'object') {
    try {
      return JSON.stringify(input);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

function formatInvocation(
  inv: ToolInvocation,
  compactable: boolean,
): string {
  const args = formatArgs(inv.input);
  if (compactable) {
    const spillHint =
      inv.spillPath ??
      (inv.output.includes('read_tool_result') && inv.output.includes('spill_key=')
        ? inv.output.match(/spill_key="([^"]+)"/)?.[1]
        : undefined);
    const suffix = spillHint ? ` → ${spillHint}` : ` → ${CLEARED_TOOL_OUTPUT}`;
    return `${inv.name}(${args}) @ ${inv.at}${suffix}`;
  }
  return `${inv.name}(${args}) @ ${inv.at} → ${clip(inv.output)}`;
}

/**
 * Builds a digest of prior completed runs for microcompact context injection.
 * When a compaction artifact exists, older history is omitted in favor of the summary.
 */
export async function buildPriorRunsDigest(
  store: Pick<Store, 'listRunsForWorkstream'>,
  workstreamId: string,
  excludeRunId: string | undefined,
  maxRuns: number,
  microcompactEnabled: boolean,
  compaction?: CompactionArtifact | null,
  keepRecentRuns = 3,
): Promise<string | null> {
  const all = await store.listRunsForWorkstream(workstreamId);
  const completed = all
    .filter(
      (r) =>
        r.status === 'done' &&
        r.id !== excludeRunId &&
        r.toolCalls.length > 0,
    )
    .sort(
      (a, b) =>
        new Date(a.finishedAt ?? a.createdAt).getTime() -
        new Date(b.finishedAt ?? b.createdAt).getTime(),
    );

  if (completed.length === 0 && !compaction?.summary) return null;

  const selected = compaction?.summary
    ? recentRunsForDigest(all, compaction, keepRecentRuns, maxRuns).filter(
        (r) => r.id !== excludeRunId,
      )
    : microcompactEnabled
      ? completed.slice(-maxRuns)
      : completed.slice(-2);

  const lines: string[] = [];

  if (compaction?.summary) {
    lines.push('Compacted session history (older runs summarized):');
    lines.push(formatCompactionForContext(compaction));
    lines.push('');
  }

  if (selected.length === 0) {
    return lines.length > 0 ? lines.join('\n') : null;
  }

  lines.push('Recent run tool activity (oldest first):');
  for (const run of selected) {
    lines.push(`Run ${run.id} [${run.role}]`);
    for (const inv of run.toolCalls) {
      const compactable =
        microcompactEnabled && COMPACTABLE_TOOLS.has(inv.name);
      lines.push(`  ${formatInvocation(inv, compactable)}`);
    }
  }
  return lines.join('\n');
}
