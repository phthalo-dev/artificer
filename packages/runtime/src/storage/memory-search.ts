import Fuse from 'fuse.js';

/** Compact, searchable record for one memory; the full content lives in its own file. */
export interface MemoryIndexEntry {
  id: string;
  title?: string;
  summary?: string;
  /** First ~200 chars of body — ranking only, not shown as the summary. */
  excerpt?: string;
  tags: string[];
  source?: string;
  kind?: string;
  /** Phase B — ignored by ranking when present. */
  related?: Array<string | { id: string; type?: string }>;
  createdAt: string;
}

export interface RankedEntry {
  entry: MemoryIndexEntry;
  score: number;
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'and',
  'or',
  'in',
  'on',
  'for',
  'is',
  'it',
  'this',
  'that',
  'with',
  'as',
  'at',
  'by',
  'be',
  'we',
  'our',
  'how',
]);

/** Fuse field weights (must sum conceptually to 1). */
const FUSE_KEYS: Array<{ name: keyof MemoryIndexEntry; weight: number }> = [
  { name: 'title', weight: 0.4 },
  { name: 'tags', weight: 0.3 },
  { name: 'summary', weight: 0.2 },
  { name: 'excerpt', weight: 0.1 },
];

const FUSE_THRESHOLD = 0.4;

/** Points added per query token that appears in the entry's tags. */
export const TAG_TOKEN_BOOST = 3;

/** Lowercase, split on non-alphanumerics, drop stopwords and 1-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function tagBoost(entry: MemoryIndexEntry, qTokens: string[]): number {
  const tagTokens = new Set(entry.tags.flatMap((t) => tokenize(t)));
  let boost = 0;
  for (const q of qTokens) {
    if (tagTokens.has(q)) boost += TAG_TOKEN_BOOST;
  }
  return boost;
}

/**
 * Keyword/fuzzy ranking. A non-empty query returns only entries that match at
 * least one query token via Fuse (threshold 0.4) or an exact tag-token boost;
 * an empty query returns all entries in recency order.
 *
 * Score formula (higher is better):
 *   score = max over query tokens of (1 - fuseDistance) + TAG_TOKEN_BOOST * matchingTagTokens
 *
 * Fuse keys/weights: title 0.4, tags 0.3, summary 0.2, excerpt 0.1.
 * Multi-token queries are OR'd (any token can match). This is the single place
 * recall scoring lives.
 */
export function rankMemories(
  query: string,
  entries: MemoryIndexEntry[],
): RankedEntry[] {
  const qTokens = tokenize(query);
  // A query that is non-empty but consists entirely of stopwords/1-char tokens
  // tokenizes to [] and intentionally falls back to the recency-ordered branch.
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

  // OR across tokens: keep the best (lowest) Fuse distance per entry id.
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

  const scored: RankedEntry[] = [];
  for (const entry of entries) {
    const dist = bestFuse.get(entry.id);
    const boost = tagBoost(entry, qTokens);
    if (dist === undefined && boost === 0) continue;
    const fusePart = dist === undefined ? 0 : 1 - dist;
    scored.push({ entry, score: fusePart + boost });
  }

  return scored.sort(
    (a, b) =>
      b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt),
  );
}
