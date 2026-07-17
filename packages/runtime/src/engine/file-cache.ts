import fs from 'node:fs/promises';
import path from 'node:path';
import type { Layout } from '../storage/layout.js';

export interface FileCacheEntry {
  path: string;
  mtimeMs: number;
  lineRange?: { start: number; end: number };
  snippet?: string;
}

interface FileCacheState {
  entries: FileCacheEntry[];
}

export class FileCache {
  private entries: FileCacheEntry[] = [];

  constructor(
    private readonly layout: Layout,
    private readonly workstreamId: string,
    private readonly maxEntries: number,
  ) {}

  static async load(
    layout: Layout,
    workstreamId: string,
    maxEntries: number,
  ): Promise<FileCache> {
    const cache = new FileCache(layout, workstreamId, maxEntries);
    const file = layout.workstreamFileCacheFile(workstreamId);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const state = JSON.parse(raw) as FileCacheState;
      cache.entries = state.entries ?? [];
    } catch {
      cache.entries = [];
    }
    return cache;
  }

  async save(): Promise<void> {
    const file = this.layout.workstreamFileCacheFile(this.workstreamId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const state: FileCacheState = { entries: this.entries };
    await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8');
  }

  recordRead(
    filePath: string,
    mtimeMs: number,
    content?: string,
    lineRange?: { start: number; end: number },
  ): void {
    this.entries = this.entries.filter((e) => e.path !== filePath);
    const snippet = content
      ? content.slice(0, 120).replace(/\s+/g, ' ').trim()
      : undefined;
    this.entries.push({
      path: filePath,
      mtimeMs,
      lineRange,
      snippet,
    });
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  formatHintBlock(): string | null {
    if (this.entries.length === 0) return null;
    const lines = this.entries.map((e) => {
      const range = e.lineRange
        ? ` (lines ${e.lineRange.start}-${e.lineRange.end})`
        : '';
      const snippet = e.snippet ? `: ${e.snippet}` : '';
      return `- ${e.path}${range}${snippet}`;
    });
    return `Recently read files:\n${lines.join('\n')}`;
  }
}
