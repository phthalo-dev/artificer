import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IdentityLayout } from './identity-layout.js';
import { rankMemories, type MemoryIndexEntry } from './memory-search.js';
import {
  memoryTextForEmbed,
  MemoryEmbeddingsStore,
  rankMemoriesHybrid,
  resolveEmbedFn,
  type EmbeddingsConfig,
  type EmbedFn,
} from './memory-embeddings.js';
import type {
  Memory,
  MemoryEdgeType,
  MemoryKind,
  MemoryRelation,
} from './types.js';
import { MEMORY_EDGE_TYPES, MEMORY_KINDS } from './types.js';

/** Cap on 1-hop neighbors relative to the matched limit. */
export const RELATED_NEIGHBOR_CAP_FACTOR = 2;

export interface MemoryGraph {
  version: '1';
  edges: Array<{ from: string; to: string; type: MemoryEdgeType }>;
}

export interface PackedMemoryQuery {
  matched: Memory[];
  related: Array<{
    from: string;
    to: string;
    type: MemoryEdgeType;
    summary?: string;
    kind?: MemoryKind;
    /** Short claim/preference body when packed within budget. */
    content?: string;
  }>;
  charBudget: { used: number; limit: number };
  /** Soft freshness footnotes (never blocking). */
  freshnessNotes?: string[];
}

export type FreshnessStatus = 'fresh' | 'stale' | 'unknown';

export function assessFreshness(
  sourceCommit: string | undefined,
  repoHead: string | null | undefined,
): FreshnessStatus {
  if (!sourceCommit) return 'unknown';
  if (!repoHead) return 'unknown';
  return sourceCommit === repoHead ||
    repoHead.startsWith(sourceCommit) ||
    sourceCommit.startsWith(repoHead)
    ? 'fresh'
    : 'stale';
}

function now(): string {
  return new Date().toISOString();
}

function newMemoryId(kind: string): string {
  return `${kind}_${randomUUID().slice(0, 8)}`;
}

function normalizeEdgeType(raw: string | undefined): MemoryEdgeType {
  if (raw && (MEMORY_EDGE_TYPES as readonly string[]).includes(raw)) {
    return raw as MemoryEdgeType;
  }
  return 'related';
}

function normalizeRelated(
  related: MemoryRelation[] | undefined,
): MemoryRelation[] | undefined {
  if (!related?.length) return undefined;
  const out: MemoryRelation[] = [];
  const seen = new Set<string>();
  for (const r of related) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, type: normalizeEdgeType(r.type) });
  }
  return out.length ? out : undefined;
}

function memoryToMarkdown(memory: Memory): string {
  const lines: string[] = [];
  lines.push(`id: "${memory.id}"`);
  if (memory.title) lines.push(`title: "${memory.title}"`);
  if (memory.summary) lines.push(`summary: "${memory.summary}"`);
  lines.push(`tags: [${memory.tags.map((t) => `"${t}"`).join(', ')}]`);
  lines.push(`kind: "${memory.kind ?? 'note'}"`);
  if (memory.source) lines.push(`source: "${memory.source}"`);
  if (memory.sourceHash) lines.push(`sourceHash: "${memory.sourceHash}"`);
  if (memory.sourceCommit) lines.push(`sourceCommit: "${memory.sourceCommit}"`);
  if (memory.related?.length) {
    lines.push('related:');
    for (const r of memory.related) {
      lines.push(`  - id: "${r.id}"`);
      lines.push(`    type: "${r.type}"`);
    }
  }
  lines.push(`createdAt: "${memory.createdAt}"`);
  if (memory.updatedAt) lines.push(`updatedAt: "${memory.updatedAt}"`);

  return `---\n${lines.join('\n')}\n---\n\n${memory.content}\n`;
}

function parseRelated(fmBlock: string): MemoryRelation[] | undefined {
  // JSON array form: related: [{"id":"...","type":"..."}] or ["id1","id2"]
  const jsonLine = fmBlock.match(/^related:\s*(\[[\s\S]*?\])\s*$/m);
  if (jsonLine) {
    try {
      const parsed = JSON.parse(jsonLine[1]) as unknown;
      if (!Array.isArray(parsed)) return undefined;
      const out: MemoryRelation[] = [];
      for (const item of parsed) {
        if (typeof item === 'string') {
          out.push({ id: item, type: 'related' });
        } else if (item && typeof item === 'object' && 'id' in item) {
          const obj = item as { id: string; type?: string };
          out.push({ id: String(obj.id), type: normalizeEdgeType(obj.type) });
        }
      }
      return normalizeRelated(out);
    } catch {
      // fall through to block form
    }
  }

  const block = fmBlock.match(/^related:\n((?:[ \t]+.+\n?)*)/m);
  if (!block) return undefined;
  const out: MemoryRelation[] = [];
  const chunks = block[1].split(/^[ \t]*-\s*/m).filter((c) => c.trim());
  for (const chunk of chunks) {
    const idMatch =
      chunk.match(/id:\s*"([^"]+)"/) ??
      chunk.match(/^"([^"]+)"/) ??
      chunk.match(/^([a-zA-Z0-9_-]+)\s*$/m);
    if (!idMatch) continue;
    const typeMatch = chunk.match(/type:\s*"([^"]+)"/);
    out.push({
      id: idMatch[1],
      type: normalizeEdgeType(typeMatch?.[1]),
    });
  }
  return normalizeRelated(out);
}

function markdownToMemory(filePath: string, raw: string): Memory | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const fmBlock = fmMatch[1];
  const content = fmMatch[2].trim();

  const get = (key: string): string | undefined => {
    const m = fmBlock.match(new RegExp(`^${key}:\\s*"(.*)"`, 'm'));
    return m?.[1];
  };
  const getTags = (): string[] => {
    const m = fmBlock.match(/^tags:\s*\[(.*)\]/m);
    if (!m) return [];
    return m[1]
      .split(',')
      .map((t) => t.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  };

  const id = get('id') ?? path.basename(filePath, '.md');
  const kindRaw = get('kind');
  const kind =
    kindRaw && (MEMORY_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as MemoryKind)
      : 'note';

  return {
    id,
    content,
    title: get('title'),
    summary: get('summary'),
    tags: getTags(),
    kind,
    source: get('source'),
    related: parseRelated(fmBlock),
    sourceHash: get('sourceHash'),
    sourceCommit: get('sourceCommit'),
    createdAt: get('createdAt') ?? now(),
    updatedAt: get('updatedAt'),
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function sanitizeRelated(
  related: MemoryRelation[] | undefined,
  knownIds: Set<string>,
): MemoryRelation[] | undefined {
  if (!related?.length) return undefined;
  const kept = related.filter((r) => knownIds.has(r.id));
  return kept.length ? kept : undefined;
}

function toIndexEntry(m: Memory, knownIds?: Set<string>): MemoryIndexEntry {
  const related = knownIds
    ? sanitizeRelated(m.related, knownIds)
    : normalizeRelated(m.related);
  return {
    id: m.id,
    title: m.title,
    summary: m.summary,
    excerpt: m.content.slice(0, 200),
    tags: m.tags,
    source: m.source,
    kind: m.kind,
    related,
    createdAt: m.createdAt,
  };
}

function neighborPriority(kind: string | undefined): number {
  if (kind === 'claim' || kind === 'preference') return 0;
  if (kind === 'entity' || kind === 'note') return 1;
  return 2; // document / unknown last
}

function formatPackedQuery(result: PackedMemoryQuery): string {
  const matchedLines = result.matched.map((m) => {
    const head = m.title ?? m.content.slice(0, 60);
    const tagStr = m.tags.length ? ` [${m.tags.join(', ')}]` : '';
    const meta = [m.kind, m.source].filter(Boolean).join(', ');
    const metaStr = meta ? ` (${meta})` : '';
    return `- ${head}${tagStr}${metaStr}\n  ${m.content}`;
  });

  const relatedLines = result.related.map((e) => {
    const summary = e.summary ? `: ${e.summary}` : '';
    const body = e.content ? `\n  ${e.content}` : '';
    return `- ${e.from} --[${e.type}]--> ${e.to}${summary}${body}`;
  });

  const noteLines = [
    `- Char budget: ${result.charBudget.used}/${result.charBudget.limit}`,
    ...(result.freshnessNotes ?? []),
  ];

  const sections = [
    '## Matched',
    matchedLines.length ? matchedLines.join('\n\n') : '(none)',
  ];
  if (relatedLines.length) {
    sections.push('## Related', relatedLines.join('\n'));
  }
  sections.push('## Notes', noteLines.join('\n'));
  return sections.join('\n\n');
}

export interface IdentityStoreOptions {
  embeddings?: EmbeddingsConfig;
  /** Override embedder (tests or custom providers). */
  embedFn?: EmbedFn;
}

export class IdentityStore {
  readonly layout: IdentityLayout;
  private readonly embeddingsConfig: EmbeddingsConfig;
  private readonly embeddingsStore: MemoryEmbeddingsStore;
  private readonly embedFn: EmbedFn | null;

  constructor(rootDir: string, options: IdentityStoreOptions = {}) {
    this.layout = new IdentityLayout(rootDir);
    this.embeddingsConfig = options.embeddings ?? { enabled: false };
    this.embeddingsStore = new MemoryEmbeddingsStore(
      this.layout.memoryEmbeddingsFile,
    );
    this.embedFn = resolveEmbedFn(this.embeddingsConfig, options.embedFn);
  }

  private get embeddingsEnabled(): boolean {
    return this.embedFn !== null;
  }

  async init(): Promise<void> {
    await ensureDir(this.layout.memoriesDir);
  }

  async addMemory(input: Omit<Memory, 'id' | 'createdAt'>): Promise<Memory> {
    const related = await this.validateRelated(input.related);
    const memory: Memory = {
      id: newMemoryId(input.kind ?? 'note'),
      createdAt: now(),
      ...input,
      related,
    };

    await fs.writeFile(
      this.layout.memoryFile(memory.id),
      memoryToMarkdown(memory),
      'utf-8',
    );
    await this.rebuildIndex();
    await this.maybeUpsertEmbedding(memory);
    return memory;
  }

  async getMemory(id: string): Promise<Memory | null> {
    try {
      const raw = await fs.readFile(this.layout.memoryFile(id), 'utf-8');
      return markdownToMemory(this.layout.memoryFile(id), raw);
    } catch {
      return null;
    }
  }

  async listMemories(): Promise<Memory[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.layout.memoriesDir);
    } catch {
      return [];
    }

    const memories: Memory[] = [];
    for (const f of entries.filter((f) => f.endsWith('.md')).sort()) {
      const filePath = path.join(this.layout.memoriesDir, f);
      const raw = await fs.readFile(filePath, 'utf-8');
      const memory = markdownToMemory(filePath, raw);
      if (memory) memories.push(memory);
    }
    return memories;
  }

  /**
   * Pull-only recall: rank the lightweight index by fuzzy/keyword overlap,
   * optionally filter by tags, and load only the top matches' full content
   * within a character budget.
   */
  async queryMemories(
    query: string,
    opts: { tags?: string[]; limit?: number; charBudget?: number } = {},
  ): Promise<Memory[]> {
    const packed = await this.queryMemoriesPacked(query, opts);
    return packed.matched;
  }

  /**
   * Rank + load matches, then 1-hop expand related neighbors into remaining
   * char budget (preferring claim/preference over long documents).
   */
  async queryMemoriesPacked(
    query: string,
    opts: {
      tags?: string[];
      limit?: number;
      charBudget?: number;
      /** Optional repo HEAD for soft sourceCommit freshness (never blocks). */
      repoHead?: string | null;
    } = {},
  ): Promise<PackedMemoryQuery> {
    const limit = Math.max(1, Math.min(opts.limit ?? 10, 50));
    const charBudget = opts.charBudget ?? 4000;
    const fullIndex = await this.readReconciledIndex();
    const knownIds = new Set(fullIndex.map((e) => e.id));
    let entries = fullIndex;
    if (opts.tags && opts.tags.length > 0) {
      const want = new Set(opts.tags.map((t) => t.toLowerCase()));
      entries = entries.filter((e) =>
        e.tags.some((t) => want.has(t.toLowerCase())),
      );
    }
    const ranked = (await this.rankEntries(query, entries)).slice(0, limit);
    const matched: Memory[] = [];
    let used = 0;
    for (let i = 0; i < ranked.length; i++) {
      const m = await this.getMemory(ranked[i].entry.id);
      if (!m) continue;
      m.related = sanitizeRelated(m.related, knownIds);
      const remaining = charBudget - used;
      if (i === 0) {
        if (m.content.length > remaining) {
          m.content =
            remaining > 0
              ? `${m.content.slice(0, remaining)}… (truncated)`
              : '… (truncated)';
        }
        matched.push(m);
        used += m.content.length;
        continue;
      }
      if (used >= charBudget) break;
      if (m.content.length > remaining) break;
      matched.push(m);
      used += m.content.length;
    }

    const indexById = new Map(fullIndex.map((e) => [e.id, e]));
    const matchedIds = new Set(matched.map((m) => m.id));
    const neighborCap = limit * RELATED_NEIGHBOR_CAP_FACTOR;

    type NeighborCand = {
      from: string;
      to: string;
      type: MemoryEdgeType;
      kind?: MemoryKind | string;
      summary?: string;
    };
    const candidates: NeighborCand[] = [];
    const seenEdge = new Set<string>();

    const addCand = (c: NeighborCand) => {
      if (matchedIds.has(c.to)) return;
      if (!indexById.has(c.to)) return;
      const key = `${c.from}->${c.to}:${c.type}`;
      if (seenEdge.has(key)) return;
      seenEdge.add(key);
      candidates.push(c);
    };

    // Forward edges from matched memories.
    for (const m of matched) {
      for (const r of m.related ?? []) {
        const target = indexById.get(r.id);
        addCand({
          from: m.id,
          to: r.id,
          type: r.type,
          kind: target?.kind,
          summary: target?.summary ?? target?.title,
        });
      }
    }
    // Reverse edges: other memories that point at a match.
    for (const e of fullIndex) {
      if (matchedIds.has(e.id)) continue;
      for (const r of e.related ?? []) {
        if (!matchedIds.has(r.id)) continue;
        addCand({
          from: r.id,
          to: e.id,
          type: r.type,
          kind: e.kind,
          summary: e.summary ?? e.title,
        });
      }
    }

    const allNeighbors = candidates
      .sort(
        (a, b) =>
          neighborPriority(a.kind) - neighborPriority(b.kind) ||
          a.to.localeCompare(b.to),
      )
      .slice(0, neighborCap);

    const relatedOut: PackedMemoryQuery['related'] = [];
    for (const n of allNeighbors) {
      if (used >= charBudget) break;
      const body = await this.getMemory(n.to);
      if (!body) continue;
      const summary = n.summary ?? body.summary ?? body.title;
      // Prefer packing claim/preference bodies; documents get a summary line only.
      if (
        (body.kind === 'claim' || body.kind === 'preference') &&
        body.content.length + used <= charBudget
      ) {
        used += body.content.length;
        relatedOut.push({
          from: n.from,
          to: n.to,
          type: n.type,
          summary,
          kind: body.kind,
          content: body.content,
        });
      } else {
        const line = `${n.from} --[${n.type}]--> ${n.to}${summary ? `: ${summary}` : ''}`;
        if (used + line.length > charBudget) break;
        used += line.length;
        relatedOut.push({
          from: n.from,
          to: n.to,
          type: n.type,
          summary,
          kind: body.kind,
        });
      }
    }

    const freshnessNotes: string[] = [];
    for (const m of matched) {
      if (!m.sourceCommit && !m.sourceHash) continue;
      const status = assessFreshness(m.sourceCommit, opts.repoHead);
      const bits = [`${m.id}`];
      if (m.sourceCommit)
        bits.push(`sourceCommit=${m.sourceCommit.slice(0, 12)}`);
      if (m.sourceHash) bits.push(`sourceHash=${m.sourceHash.slice(0, 12)}`);
      bits.push(`freshness=${status}`);
      freshnessNotes.push(`- ${bits.join(' ')}`);
    }

    return {
      matched,
      related: relatedOut,
      charBudget: { used, limit: charBudget },
      freshnessNotes: freshnessNotes.length ? freshnessNotes : undefined,
    };
  }

  /** Format a packed query for the query_memories tool response. */
  formatPackedQuery(result: PackedMemoryQuery): string {
    return formatPackedQuery(result);
  }

  /** Compact "you know things" hint for context (count + top tags); no content. */
  async memorySignpost(): Promise<string | null> {
    const entries = await this.readReconciledIndex();
    if (entries.length === 0) return null;
    const counts = new Map<string, number>();
    for (const e of entries) {
      for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const topTags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([t]) => t);
    const topics = topTags.length ? ` (topics: ${topTags.join(', ')})` : '';
    return `You have ${entries.length} memories${topics}. Use query_memories to recall anything relevant before answering.`;
  }

  async updateMemory(
    id: string,
    patch: Partial<
      Pick<
        Memory,
        | 'content'
        | 'title'
        | 'summary'
        | 'tags'
        | 'related'
        | 'kind'
        | 'sourceHash'
        | 'sourceCommit'
      >
    >,
  ): Promise<Memory | null> {
    const existing = await this.getMemory(id);
    if (!existing) return null;
    const related =
      patch.related !== undefined
        ? await this.validateRelated(patch.related)
        : existing.related;
    const updated: Memory = {
      ...existing,
      ...patch,
      related,
      updatedAt: now(),
    };
    await fs.writeFile(
      this.layout.memoryFile(id),
      memoryToMarkdown(updated),
      'utf-8',
    );
    await this.rebuildIndex();
    await this.maybeUpsertEmbedding(updated);
    return updated;
  }

  async deleteMemory(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.layout.memoryFile(id));
      await this.rebuildIndex();
      if (this.embeddingsEnabled) {
        await this.embeddingsStore.remove(id);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async rankEntries(query: string, entries: MemoryIndexEntry[]) {
    if (!this.embedFn || !query.trim()) {
      return rankMemories(query, entries);
    }
    const vectors = await this.embeddingsStore.readAll();
    let queryVector: number[];
    try {
      queryVector = await this.embedFn(query);
    } catch (err) {
      console.warn(
        '[identity-store] query embedding failed; lexical only:',
        err,
      );
      return rankMemories(query, entries);
    }
    return rankMemoriesHybrid(query, entries, vectors, queryVector);
  }

  private async maybeUpsertEmbedding(memory: Memory): Promise<void> {
    if (!this.embedFn) return;
    const text = memoryTextForEmbed({
      title: memory.title,
      summary: memory.summary,
      tags: memory.tags,
      excerpt: memory.content.slice(0, 200),
    });
    try {
      const vector = await this.embedFn(text);
      await this.embeddingsStore.upsert(memory.id, vector);
    } catch (err) {
      console.warn(
        `[identity-store] embedding upsert failed for ${memory.id}:`,
        err,
      );
    }
  }

  private async validateRelated(
    related: MemoryRelation[] | undefined,
  ): Promise<MemoryRelation[] | undefined> {
    const normalized = normalizeRelated(related);
    if (!normalized?.length) return undefined;
    const kept: MemoryRelation[] = [];
    for (const r of normalized) {
      const target = await this.getMemory(r.id);
      if (!target) {
        console.warn(
          `[identity-store] dropping related edge to missing memory ${r.id}`,
        );
        continue;
      }
      kept.push(r);
    }
    return kept.length ? kept : undefined;
  }

  private async rebuildIndex(): Promise<void> {
    const all = await this.listMemories();
    const knownIds = new Set(all.map((m) => m.id));
    const index = all.map((m) => toIndexEntry(m, knownIds));
    await ensureDir(path.dirname(this.layout.memoryIndexFile));
    await fs.writeFile(
      this.layout.memoryIndexFile,
      JSON.stringify(index, null, 2),
      'utf-8',
    );

    const edges: MemoryGraph['edges'] = [];
    for (const e of index) {
      for (const r of e.related ?? []) {
        edges.push({ from: e.id, to: r.id, type: r.type });
      }
    }
    const graph: MemoryGraph = { version: '1', edges };
    await fs.writeFile(
      this.layout.memoryGraphFile,
      JSON.stringify(graph, null, 2),
      'utf-8',
    );
  }

  /** Read index.json; rebuild from memory files if missing/unreadable. */
  private async readMemoryIndex(): Promise<MemoryIndexEntry[]> {
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.layout.memoryIndexFile, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (raw !== null) {
      try {
        return JSON.parse(raw) as MemoryIndexEntry[];
      } catch {
        // Corrupt index.json — fall through and rebuild.
      }
    }
    await this.rebuildIndex();
    return JSON.parse(
      await fs.readFile(this.layout.memoryIndexFile, 'utf-8'),
    ) as MemoryIndexEntry[];
  }

  private async countMemoryFiles(): Promise<number> {
    try {
      const names = await fs.readdir(this.layout.memoriesDir);
      return names.filter((f) => f.endsWith('.md')).length;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }
  }

  /**
   * Self-heals a stale or corrupt index: if entry count drifts from the number
   * of memory files, or the index contains duplicate ids, rebuild from disk.
   */
  private async readReconciledIndex(): Promise<MemoryIndexEntry[]> {
    const index = await this.readMemoryIndex();
    const fileCount = await this.countMemoryFiles();
    const uniqueIds = new Set(index.map((e) => e.id));
    const drift = index.length !== fileCount || uniqueIds.size !== index.length;
    if (!drift) return index;
    await this.rebuildIndex();
    return JSON.parse(
      await fs.readFile(this.layout.memoryIndexFile, 'utf-8'),
    ) as MemoryIndexEntry[];
  }
}
