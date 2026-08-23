import type { Store } from '../storage/store.js';
import type { RunRecord, ToolInvocation } from '../storage/types.js';

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

export const MAX_DIFF_CHARS = 8_000;

/** Caps a git diff to a character budget for inclusion in call context. */
export function clipDiff(diff: string, max = MAX_DIFF_CHARS): string {
  return diff.length <= max
    ? diff
    : `${diff.slice(0, max)}\n… (diff truncated)`;
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

const SHELL_FAILURE_RE = /^Command (failed|timed out)/;

function countLines(text: string): number {
  return text === '' ? 0 : text.split('\n').length;
}

/**
 * One-line, deterministic summary of a compactable tool's output, used in
 * place of the full output once a run is no longer the most recent. Keeps
 * just enough signal (line/match/char counts, shell success) for the model
 * to know what happened without paying for the original content again.
 */
export function summarizeToolResult(inv: ToolInvocation): string {
  const { name, output } = inv;
  if (name === 'read_file') return `${countLines(output)} lines`;
  if (name === 'run_shell') {
    const failed = SHELL_FAILURE_RE.test(output);
    return `${failed ? 'failed' : 'ok'}, ${countLines(output)} lines output`;
  }
  if (name === 'grep' || name === 'glob') {
    return `${output.trim() === '(no matches)' ? 0 : countLines(output)} matches`;
  }
  if (name === 'fetch_url') return `${output.length} chars`;
  return clip(output);
}

function formatInvocation(inv: ToolInvocation, compactable: boolean): string {
  const args = formatArgs(inv.input);
  if (compactable) {
    const spillHint =
      inv.spillPath ??
      (inv.output.includes('read_tool_result') &&
      inv.output.includes('spill_key=')
        ? inv.output.match(/spill_key="([^"]+)"/)?.[1]
        : undefined);
    const suffix = spillHint
      ? ` → ${spillHint}`
      : ` → ${summarizeToolResult(inv)}`;
    return `${inv.name}(${args}) @ ${inv.at}${suffix}`;
  }
  return `${inv.name}(${args}) @ ${inv.at} → ${clip(inv.output)}`;
}

function completedRuns(runs: RunRecord[], excludeRunId?: string): RunRecord[] {
  return runs
    .filter(
      (r) =>
        r.status === 'done' && r.id !== excludeRunId && r.toolCalls.length > 0,
    )
    .sort(
      (a, b) =>
        new Date(a.finishedAt ?? a.createdAt).getTime() -
        new Date(b.finishedAt ?? b.createdAt).getTime(),
    );
}

/**
 * Builds a digest of prior completed runs for microcompact context injection.
 */
export async function buildPriorRunsDigest(
  store: Pick<Store, 'listRunsForWorkstream'>,
  workstreamId: string,
  excludeRunId: string | undefined,
  maxRuns: number,
  microcompactEnabled: boolean,
): Promise<string | null> {
  const all = await store.listRunsForWorkstream(workstreamId);
  const completed = completedRuns(all, excludeRunId);
  if (completed.length === 0) return null;

  // Uncompacted outputs are expensive; cap at 2 unless the profile asks for fewer
  // (GPT-5 aggressive = 1). Microcompacted one-liners can afford the full window.
  const selected = microcompactEnabled
    ? completed.slice(-maxRuns)
    : completed.slice(-Math.min(2, maxRuns));

  const lines: string[] = ['Prior run tool activity (oldest first):'];
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
