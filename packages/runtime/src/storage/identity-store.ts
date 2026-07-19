import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IdentityLayout } from './identity-layout.js';
import { rankMemories, type MemoryIndexEntry } from './memory-search.js';
import type { Memory } from './types.js';

function now(): string {
  return new Date().toISOString();
}

function newMemoryId(kind: string): string {
  return `${kind}_${randomUUID().slice(0, 8)}`;
}

function memoryToMarkdown(memory: Memory): string {
  const lines: string[] = [];
  lines.push(`id: "${memory.id}"`);
  if (memory.title) lines.push(`title: "${memory.title}"`);
  if (memory.summary) lines.push(`summary: "${memory.summary}"`);
  lines.push(`tags: [${memory.tags.map((t) => `"${t}"`).join(', ')}]`);
  lines.push(`kind: "${memory.kind ?? 'note'}"`);
  if (memory.source) lines.push(`source: "${memory.source}"`);
  lines.push(`createdAt: "${memory.createdAt}"`);
  if (memory.updatedAt) lines.push(`updatedAt: "${memory.updatedAt}"`);

  return `---\n${lines.join('\n')}\n---\n\n${memory.content}\n`;
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

  return {
    id,
    content,
    title: get('title'),
    summary: get('summary'),
    tags: getTags(),
    kind: (get('kind') as Memory['kind']) ?? 'note',
    source: get('source'),
    createdAt: get('createdAt') ?? now(),
    updatedAt: get('updatedAt'),
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function toIndexEntry(m: Memory): MemoryIndexEntry {
  return {
    id: m.id,
    title: m.title,
    summary: m.summary,
    excerpt: m.content.slice(0, 200),
    tags: m.tags,
    source: m.source,
    kind: m.kind,
    createdAt: m.createdAt,
  };
}

export class IdentityStore {
  readonly layout: IdentityLayout;

  constructor(rootDir: string) {
    this.layout = new IdentityLayout(rootDir);
  }

  async init(): Promise<void> {
    await ensureDir(this.layout.memoriesDir);
  }

  async addMemory(input: Omit<Memory, 'id' | 'createdAt'>): Promise<Memory> {
    const memory: Memory = {
      id: newMemoryId(input.kind ?? 'note'),
      createdAt: now(),
      ...input,
    };

    await fs.writeFile(
      this.layout.memoryFile(memory.id),
      memoryToMarkdown(memory),
      'utf-8',
    );
    await this.rebuildIndex();
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
    const limit = Math.max(1, Math.min(opts.limit ?? 10, 50));
    const charBudget = opts.charBudget ?? 4000;
    let entries = await this.readReconciledIndex();
    if (opts.tags && opts.tags.length > 0) {
      const want = new Set(opts.tags.map((t) => t.toLowerCase()));
      entries = entries.filter((e) =>
        e.tags.some((t) => want.has(t.toLowerCase())),
      );
    }
    const ranked = rankMemories(query, entries).slice(0, limit);
    const out: Memory[] = [];
    let used = 0;
    for (let i = 0; i < ranked.length; i++) {
      const m = await this.getMemory(ranked[i].entry.id);
      if (!m) continue;
      const remaining = charBudget - used;
      if (i === 0) {
        // Always include the top hit; truncate body if it alone exceeds budget.
        if (m.content.length > remaining) {
          m.content =
            remaining > 0
              ? `${m.content.slice(0, remaining)}… (truncated)`
              : '… (truncated)';
        }
        out.push(m);
        used += m.content.length;
        continue;
      }
      if (used >= charBudget) break;
      if (m.content.length > remaining) {
        // Skip later hits that would blow the budget rather than truncating them.
        break;
      }
      out.push(m);
      used += m.content.length;
    }
    return out;
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
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);
    const topics = topTags.length ? ` (topics: ${topTags.join(', ')})` : '';
    return `You have ${entries.length} memories${topics}. Use query_memories to recall anything relevant before answering.`;
  }

  async updateMemory(
    id: string,
    patch: Partial<Pick<Memory, 'content' | 'title' | 'summary' | 'tags'>>,
  ): Promise<Memory | null> {
    const existing = await this.getMemory(id);
    if (!existing) return null;
    const updated: Memory = {
      ...existing,
      ...patch,
      updatedAt: now(),
    };
    await fs.writeFile(
      this.layout.memoryFile(id),
      memoryToMarkdown(updated),
      'utf-8',
    );
    await this.rebuildIndex();
    return updated;
  }

  async deleteMemory(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.layout.memoryFile(id));
      await this.rebuildIndex();
      return true;
    } catch {
      return false;
    }
  }

  private async rebuildIndex(): Promise<void> {
    const all = await this.listMemories();
    const index = all.map((m) => toIndexEntry(m));
    await ensureDir(path.dirname(this.layout.memoryIndexFile));
    await fs.writeFile(
      this.layout.memoryIndexFile,
      JSON.stringify(index, null, 2),
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
    const rebuilt = (await this.listMemories()).map((m) => toIndexEntry(m));
    await ensureDir(path.dirname(this.layout.memoryIndexFile));
    await fs.writeFile(
      this.layout.memoryIndexFile,
      JSON.stringify(rebuilt, null, 2),
      'utf-8',
    );
    return rebuilt;
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
    const rebuilt = (await this.listMemories()).map((m) => toIndexEntry(m));
    await ensureDir(path.dirname(this.layout.memoryIndexFile));
    await fs.writeFile(
      this.layout.memoryIndexFile,
      JSON.stringify(rebuilt, null, 2),
      'utf-8',
    );
    return rebuilt;
  }
}
