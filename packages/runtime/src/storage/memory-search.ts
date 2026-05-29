/** Compact, searchable record for one memory; the full content lives in its own file. */
export interface MemoryIndexEntry {
  id: string;
  title?: string;
  summary?: string;
  tags: string[];
  source?: string;
  createdAt: string;
}

export interface RankedEntry {
  entry: MemoryIndexEntry;
  score: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'is', 'it',
  'this', 'that', 'with', 'as', 'at', 'by', 'be', 'we', 'our', 'how',
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and 1-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function entryText(e: MemoryIndexEntry): string {
  return [e.title, e.summary, e.tags.join(' ')].filter(Boolean).join(' ');
}

/**
 * Keyword/lexical ranking. A non-empty query returns only entries that match at
 * least one query token (tag matches are boosted); an empty query returns all
 * entries in recency order. This is the single place recall scoring lives, so a
 * semantic ranker could replace it later without touching callers.
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
  const scored = entries.map((entry) => {
    const counts = new Map<string, number>();
    for (const tok of tokenize(entryText(entry))) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
    const tagTokens = new Set(entry.tags.flatMap((t) => tokenize(t)));
    let score = 0;
    for (const q of qTokens) {
      score += counts.get(q) ?? 0;
      if (tagTokens.has(q)) score += 3;
    }
    return { entry, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt),
    );
}
