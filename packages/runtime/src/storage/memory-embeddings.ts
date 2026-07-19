import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import type { MemoryIndexEntry, RankedEntry } from './memory-search.js';
import { rankMemories } from './memory-search.js';

export type EmbeddingProviderName = 'openai' | 'local' | 'none';

export interface EmbeddingsConfig {
  enabled?: boolean;
  provider?: EmbeddingProviderName;
  model?: string;
}

/** Injected embedder (tests / custom providers). */
export type EmbedFn = (text: string) => Promise<number[]>;

const DEFAULT_OPENAI_EMBED_MODEL = 'text-embedding-3-small';

/** Deterministic local bag-of-tokens embedding (no external provider). */
export function localEmbed(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  for (const tok of tokens) {
    const h = createHash('sha256').update(tok).digest();
    const idx = h.readUInt32BE(0) % dims;
    const sign = h[4] & 1 ? 1 : -1;
    vec[idx] += sign;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Call OpenAI embeddings via the AI SDK. Requires OPENAI_API_KEY or LLM_API_KEY. */
export async function openaiEmbed(
  text: string,
  model = DEFAULT_OPENAI_EMBED_MODEL,
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('openai embeddings require OPENAI_API_KEY or LLM_API_KEY');
  }
  const openai = createOpenAI({ apiKey });
  const { embedding } = await embed({
    model: openai.embedding(model),
    value: text,
  });
  return embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Reciprocal rank fusion of word-based ranks and embedding cosine ranks.
 * Callers of pure `rankMemories` stay unchanged.
 */
export function rankMemoriesHybrid(
  query: string,
  entries: MemoryIndexEntry[],
  vectors: Record<string, number[]>,
  queryVector: number[],
): RankedEntry[] {
  const lexical = rankMemories(query, entries);
  if (Object.keys(vectors).length === 0) return lexical;

  const withVectors = entries.filter((e) => vectors[e.id]?.length);
  if (withVectors.length < Math.max(1, Math.floor(entries.length * 0.25))) {
    // Not enough coverage — stay word-matching only.
    return lexical;
  }

  const semantic = [...withVectors]
    .map((entry) => ({
      entry,
      score: cosineSimilarity(queryVector, vectors[entry.id]!),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt),
    );

  const k = 60;
  const fused = new Map<string, { entry: MemoryIndexEntry; score: number }>();
  lexical.forEach((r, i) => {
    fused.set(r.entry.id, {
      entry: r.entry,
      score: 1 / (k + i + 1),
    });
  });
  semantic.forEach((r, i) => {
    const prev = fused.get(r.entry.id);
    const add = 1 / (k + i + 1);
    if (prev) prev.score += add;
    else fused.set(r.entry.id, { entry: r.entry, score: add });
  });

  return [...fused.values()].sort(
    (a, b) =>
      b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt),
  );
}

export function memoryTextForEmbed(parts: {
  title?: string;
  summary?: string;
  tags: string[];
  excerpt?: string;
}): string {
  return [parts.title, parts.summary, parts.tags.join(' '), parts.excerpt]
    .filter(Boolean)
    .join(' ');
}

/** @deprecated Prefer memoryTextForEmbed + resolveEmbedFn */
export function embedTextForMemory(parts: {
  title?: string;
  summary?: string;
  tags: string[];
  excerpt?: string;
}): number[] {
  return localEmbed(memoryTextForEmbed(parts));
}

export function resolveEmbedFn(
  config: EmbeddingsConfig,
  override?: EmbedFn,
): EmbedFn | null {
  if (override) return override;
  if (config.enabled !== true || config.provider === 'none') return null;
  if (config.provider === 'openai') {
    const model = config.model ?? DEFAULT_OPENAI_EMBED_MODEL;
    return (text) => openaiEmbed(text, model);
  }
  // local (default when enabled without openai)
  return async (text) => localEmbed(text);
}

export class MemoryEmbeddingsStore {
  constructor(private readonly filePath: string) {}

  async readAll(): Promise<Record<string, number[]>> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as Record<string, number[]>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async writeAll(map: Record<string, number[]>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(map, null, 2), 'utf-8');
  }

  async upsert(id: string, vector: number[]): Promise<void> {
    const all = await this.readAll();
    all[id] = vector;
    await this.writeAll(all);
  }

  async remove(id: string): Promise<void> {
    const all = await this.readAll();
    if (!(id in all)) return;
    delete all[id];
    await this.writeAll(all);
  }
}
