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
  lines.push(
    `tags: [${memory.tags.map((t) => `"${t}"`).join(', ')}]`,
  );
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

export class IdentityStore {
  readonly layout: IdentityLayout;

  constructor(rootDir: string) {
    this.layout = new IdentityLayout(rootDir);
  }

  async init(): Promise<void> {
    await ensureDir(this.layout.memoriesDir);
  }

  async addMemory(
    input: Omit<Memory, 'id' | 'createdAt'>,
  ): Promise<Memory> {
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

  async queryMemories(query: string, limit = 10): Promise<Memory[]> {
    const all = await this.listMemories();
    const index: MemoryIndexEntry[] = all.map((m) => ({
      id: m.id,
      title: m.title,
      summary: m.summary ?? m.content.slice(0, 200),
      tags: m.tags,
      createdAt: m.createdAt,
    }));
    const ranked = rankMemories(query, index).slice(0, limit);
    const idSet = new Set(ranked.map((r) => r.entry.id));
    return all.filter((m) => idSet.has(m.id));
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
    const index: MemoryIndexEntry[] = all.map((m) => ({
      id: m.id,
      title: m.title,
      summary: m.summary ?? m.content.slice(0, 200),
      tags: m.tags,
      createdAt: m.createdAt,
    }));
    await fs.writeFile(
      this.layout.memoryIndexFile,
      JSON.stringify(index, null, 2),
      'utf-8',
    );
  }
}
