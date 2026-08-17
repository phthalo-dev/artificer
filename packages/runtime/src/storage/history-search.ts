import Fuse from 'fuse.js';
import { tokenize } from './memory-search.js';
import type { RunRecord } from './types.js';

/** Compact, searchable record for one terminal run; the full record lives in runs/<id>.json. */
export interface RunIndexEntry {
  id: string;
  role: string;
  status: 'done' | 'failed';
  workstreamId?: string;
  model?: string;
  /** First TASK_EXCERPT_MAX chars of the run's task. */
  taskExcerpt: string;
  /** First OUTPUT_EXCERPT_MAX chars of the run's output (or error, if output is empty). */
  outputExcerpt: string;
  createdAt: string;
}

export interface RankedRunEntry {
  entry: RunIndexEntry;
  score: number;
}

export const TASK_EXCERPT_MAX = 200;
export const OUTPUT_EXCERPT_MAX = 300;

/**
 * Roles whose terminal runs are eligible for the search_history index — the
 * four "work outcome" roles the design spec scopes recall to. `communicator`
 * (whose task text is built from the chat transcript itself, so indexing it
 * would just duplicate get_recent_messages) and `orchestrator` (pure
 * routing/bookkeeping, not a work outcome) are deliberately excluded.
 */
export const INDEXABLE_RUN_ROLES: ReadonlySet<string> = new Set([
  'planner',
  'worker',
  'reviewer',
  'librarian',
]);

export function isIndexableRunRole(role: string): boolean {
  return INDEXABLE_RUN_ROLES.has(role);
}

/**
 * Slice text to `max` chars, appending an ellipsis + "(truncated)" marker
 * (matching Store.queryMemories' convention) only when truncation actually
 * happened — so the model can tell a complete short field from a cut-off one.
 */
function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (truncated)`;
}

/** Build the lightweight index entry for a terminal run. Never copies toolCalls/usage. */
export function buildRunIndexEntry(run: RunRecord): RunIndexEntry {
  const status = run.status === 'failed' ? 'failed' : 'done';
  const outputSource = run.output || run.error || '';
  const entry: RunIndexEntry = {
    id: run.id,
    role: run.role,
    status,
    taskExcerpt: excerpt(run.task, TASK_EXCERPT_MAX),
    outputExcerpt: excerpt(outputSource, OUTPUT_EXCERPT_MAX),
    createdAt: run.createdAt,
  };
  if (run.workstreamId) entry.workstreamId = run.workstreamId;
  if (run.model) entry.model = run.model;
  return entry;
}

const FUSE_KEYS: Array<{ name: keyof RunIndexEntry; weight: number }> = [
  { name: 'taskExcerpt', weight: 0.6 },
  { name: 'outputExcerpt', weight: 0.4 },
];

const FUSE_THRESHOLD = 0.4;

/**
 * Keyword/fuzzy ranking over run excerpts, mirroring rankMemories' approach
 * (memory-search.ts) with no tag boost — runs have no tags. An empty query
 * (or a query that tokenizes to nothing, e.g. all stopwords) returns all
 * entries in recency order.
 */
export function rankRuns(
  query: string,
  entries: RunIndexEntry[],
): RankedRunEntry[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) {
    return [...entries]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((entry) => ({ entry, score: 0 }));
  }

  const fuse = new Fuse(entries, {
    keys: FUSE_KEYS,
    threshold: FUSE_THRESHOLD,
    includeScore: true,
    ignoreLocation: true,
  });

  const bestFuse = new Map<string, number>();
  for (const token of qTokens) {
    for (const hit of fuse.search(token)) {
      const dist = hit.score ?? 1;
      const prev = bestFuse.get(hit.item.id);
      if (prev === undefined || dist < prev) {
        bestFuse.set(hit.item.id, dist);
      }
    }
  }

  const scored: RankedRunEntry[] = [];
  for (const entry of entries) {
    const dist = bestFuse.get(entry.id);
    if (dist === undefined) continue;
    scored.push({ entry, score: 1 - dist });
  }

  return scored.sort(
    (a, b) =>
      b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt),
  );
}
