import type { CompactionArtifact } from '../storage/types.js';
import { extractFileOps, formatFileOpsLedger } from './file-ops.js';
import type { RunRecord } from '../storage/types.js';
import type { Workstream } from '../storage/types.js';

export const SUMMARY_PREFIX =
  '[Session compaction summary — reference only. The latest task message and ' +
  'recent run activity take precedence if they conflict with this summary.]\n\n';

const SUMMARIZER_SYSTEM = `You summarize agent workstream history for continuation.
Be concise and factual. Use markdown sections exactly as requested.
Do not invent files, tests, or outcomes not present in the input.`;

export function buildSummaryRequest(input: {
  workstream: Pick<Workstream, 'goal' | 'title'>;
  planExcerpt: string | null;
  runsText: string;
  priorSummary: string | null;
  fileOpsLedger: string;
}): string {
  const parts = [
    'Summarize this workstream session for continuation.',
    '',
    `## Goal\n${input.workstream.title}\n${input.workstream.goal}`,
  ];

  if (input.planExcerpt) {
    parts.push('', '## Plan excerpt', input.planExcerpt);
  }

  if (input.priorSummary) {
    parts.push('', '## Prior compaction (merge forward, do not repeat verbatim)', input.priorSummary);
  }

  if (input.fileOpsLedger) {
    parts.push('', '## File operations', input.fileOpsLedger);
  }

  parts.push(
    '',
    '## Session history to summarize',
    input.runsText,
    '',
    'Respond with these sections:',
    '## Goal',
    '## State (Done / In Progress / Blocked)',
    '## Highlights',
    '## Next',
    '## Files',
  );

  return parts.join('\n');
}

export function wrapCompactionSummary(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return SUMMARY_PREFIX + '(empty summary)';
  if (trimmed.startsWith(SUMMARY_PREFIX.trim())) return trimmed;
  return `${SUMMARY_PREFIX}${trimmed}`;
}

export function formatCompactionForContext(artifact: CompactionArtifact): string {
  return wrapCompactionSummary(artifact.summary);
}

export function buildFileOpsFromRuns(runs: RunRecord[]): string {
  return formatFileOpsLedger(extractFileOps(runs));
}

export { SUMMARIZER_SYSTEM };
