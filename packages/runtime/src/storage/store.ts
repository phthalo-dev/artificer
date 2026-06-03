import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Layout } from './layout.js';
import {
  rankMemories,
  type MemoryIndexEntry,
} from './memory-search.js';
import {
  emptyUsage,
  type Memory,
  type Message,
  type Review,
  type RunRecord,
  type Task,
  type Workstream,
  type WorkstreamStatus,
} from './types.js';

function now(): string {
  return new Date().toISOString();
}

/** Short, filesystem-safe id. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Per-target serialization so concurrent saveRun calls cannot collide on rename. */
const writeChains = new Map<string, Promise<void>>();

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, file);
}

async function writeJson(file: string, data: unknown): Promise<void> {
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => writeJsonAtomic(file, data));
  writeChains.set(file, next);
  await next;
}

async function readJson<T>(file: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      if (!raw.trim()) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
        return null;
      }
      if (err instanceof SyntaxError && attempt < 2) {
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  return null;
}

/** List subdirectory names in a dir, ignoring stray files like .DS_Store. */
async function listDirNames(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

async function listJson<T>(dir: string): Promise<T[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files = entries.filter((f) => f.endsWith('.json')).sort();
  const out: T[] = [];
  for (const f of files) {
    const data = await readJson<T>(path.join(dir, f));
    if (data) out.push(data);
  }
  return out;
}

/**
 * File-backed persistence for all runtime state. There is no database: every
 * message, workstream, task, review, run, and memory is a file on disk.
 */
export class Store {
  readonly layout: Layout;

  constructor(dataDir: string) {
    this.layout = new Layout(dataDir);
  }

  async init(): Promise<void> {
    await Promise.all([
      ensureDir(this.layout.messagesDir),
      ensureDir(this.layout.workstreamsDir),
      ensureDir(this.layout.runsDir),
      ensureDir(this.layout.memoriesDir),
      ensureDir(this.layout.workspaceDir),
    ]);
  }

  // --- Messages (the conversation with the outside world) ---

  async appendMessage(
    input: Omit<Message, 'id' | 'createdAt'>,
  ): Promise<Message> {
    const message: Message = { id: newId('msg'), createdAt: now(), ...input };
    await writeJson(
      this.layout.messageFile(message.id, message.createdAt),
      message,
    );
    return message;
  }

  async listMessages(): Promise<Message[]> {
    return listJson<Message>(this.layout.messagesDir);
  }

  // --- Workstreams ---

  async createWorkstream(
    input: Pick<Workstream, 'title' | 'goal'> &
      Partial<Pick<Workstream, 'repoUrl' | 'baseCommit' | 'summary' | 'status'>>,
  ): Promise<Workstream> {
    const ts = now();
    const workstream: Workstream = {
      id: newId('ws'),
      title: input.title,
      goal: input.goal,
      status: input.status ?? 'pending',
      summary: input.summary ?? '',
      repoUrl: input.repoUrl,
      baseCommit: input.baseCommit,
      createdAt: ts,
      updatedAt: ts,
    };
    await writeJson(this.layout.workstreamFile(workstream.id), workstream);
    await ensureDir(this.layout.workstreamWorkspace(workstream.id));
    return workstream;
  }

  async getWorkstream(id: string): Promise<Workstream | null> {
    return readJson<Workstream>(this.layout.workstreamFile(id));
  }

  async updateWorkstream(
    id: string,
    patch: Partial<
      Pick<Workstream, 'status' | 'summary' | 'title' | 'repoUrl' | 'baseCommit'>
    >,
  ): Promise<Workstream | null> {
    const existing = await this.getWorkstream(id);
    if (!existing) return null;
    const updated: Workstream = { ...existing, ...patch, updatedAt: now() };
    await writeJson(this.layout.workstreamFile(id), updated);
    return updated;
  }

  async listWorkstreams(): Promise<Workstream[]> {
    const entries = await listDirNames(this.layout.workstreamsDir);
    const out: Workstream[] = [];
    for (const name of entries) {
      const ws = await this.getWorkstream(name);
      if (ws) out.push(ws);
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  // --- Plan artifact ---

  async writePlan(workstreamId: string, content: string): Promise<void> {
    const file = this.layout.planFile(workstreamId);
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, content, 'utf8');
  }

  async readPlan(workstreamId: string): Promise<string | null> {
    try {
      return await fs.readFile(this.layout.planFile(workstreamId), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  // --- Tasks ---

  async createTask(
    input: Pick<Task, 'workstreamId' | 'role' | 'description'> &
      Partial<Pick<Task, 'status' | 'runId' | 'parentRunId'>>,
  ): Promise<Task> {
    const ts = now();
    const task: Task = {
      id: newId('task'),
      workstreamId: input.workstreamId,
      role: input.role,
      description: input.description,
      status: input.status ?? 'pending',
      runId: input.runId,
      parentRunId: input.parentRunId,
      createdAt: ts,
      updatedAt: ts,
    };
    await writeJson(
      this.layout.taskFile(task.workstreamId, task.id),
      task,
    );
    return task;
  }

  async updateTask(
    workstreamId: string,
    taskId: string,
    patch: Partial<Pick<Task, 'status' | 'result' | 'runId'>>,
  ): Promise<Task | null> {
    const file = this.layout.taskFile(workstreamId, taskId);
    const existing = await readJson<Task>(file);
    if (!existing) return null;
    const updated: Task = { ...existing, ...patch, updatedAt: now() };
    await writeJson(file, updated);
    return updated;
  }

  async listTasks(workstreamId: string): Promise<Task[]> {
    return listJson<Task>(this.layout.tasksDir(workstreamId));
  }

  // --- Reviews ---

  async createReview(
    input: Pick<
      Review,
      'workstreamId' | 'target' | 'notes' | 'approved' | 'stage' | 'severity'
    >,
  ): Promise<Review> {
    const review: Review = {
      id: newId('rev'),
      createdAt: now(),
      ...input,
    };
    await writeJson(
      this.layout.reviewFile(review.workstreamId, review.id),
      review,
    );
    return review;
  }

  async listReviews(workstreamId: string): Promise<Review[]> {
    return listJson<Review>(this.layout.reviewsDir(workstreamId));
  }

  // --- Runs (one record per LLM call) ---

  async createRun(
    input: Pick<RunRecord, 'role' | 'task'> &
      Partial<
        Pick<
          RunRecord,
          | 'workstreamId'
          | 'taskId'
          | 'parentRunId'
          | 'originMessageId'
          | 'model'
          | 'status'
        >
      >,
  ): Promise<RunRecord> {
    const run: RunRecord = {
      id: newId('run'),
      role: input.role,
      task: input.task,
      workstreamId: input.workstreamId,
      taskId: input.taskId,
      parentRunId: input.parentRunId,
      originMessageId: input.originMessageId,
      model: input.model,
      status: input.status ?? 'queued',
      toolCalls: [],
      usage: emptyUsage(),
      createdAt: now(),
    };
    await writeJson(this.layout.runFile(run.id), run);
    return run;
  }

  async saveRun(run: RunRecord): Promise<void> {
    await writeJson(this.layout.runFile(run.id), run);
  }

  async getRun(id: string): Promise<RunRecord | null> {
    return readJson<RunRecord>(this.layout.runFile(id));
  }

  async listRuns(): Promise<RunRecord[]> {
    return listJson<RunRecord>(this.layout.runsDir);
  }

  async listRunsForWorkstream(workstreamId: string): Promise<RunRecord[]> {
    const all = await this.listRuns();
    return all.filter((r) => r.workstreamId === workstreamId);
  }

  // --- Memories ---

  async addMemory(input: {
    content: string;
    tags?: string[];
    title?: string;
    summary?: string;
    source?: string;
    kind?: Memory['kind'];
  }): Promise<Memory> {
    const createdAt = now();
    const memory: Memory = {
      id: newId('mem'),
      content: input.content,
      tags: input.tags ?? [],
      title: input.title,
      summary: input.summary,
      source: input.source,
      kind: input.kind,
      createdAt,
      updatedAt: createdAt,
    };
    await writeJson(this.layout.memoryFile(memory.id, memory.createdAt), memory);
    const index = await this.readMemoryIndex();
    if (!index.some((e) => e.id === memory.id)) {
      index.push(this.toIndexEntry(memory));
    }
    await writeJson(this.layout.memoryIndexFile(), index);
    return memory;
  }

  /** All memories, newest-first, reading the per-memory files (excludes index.json). */
  async listMemories(): Promise<Memory[]> {
    const dir = this.layout.memoriesDir;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const files = names
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .sort()
      .reverse();
    const out: Memory[] = [];
    for (const f of files) {
      const m = await readJson<Memory>(path.join(dir, f));
      if (m) out.push(m);
    }
    return out;
  }

  /**
   * Pull-only recall: rank the lightweight index by keyword overlap, optionally
   * filter by tags, and load only the top matches' full content within a budget.
   */
  async queryMemories(
    query: string,
    opts: { tags?: string[]; limit?: number; charBudget?: number } = {},
  ): Promise<Memory[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 5, 50));
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
    for (const r of ranked) {
      const m = await readJson<Memory>(
        this.layout.memoryFile(r.entry.id, r.entry.createdAt),
      );
      if (!m) continue;
      out.push(m);
      used += m.content.length;
      if (used >= charBudget) break;
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

  private toIndexEntry(m: Memory): MemoryIndexEntry {
    return {
      id: m.id,
      title: m.title,
      summary: m.summary,
      tags: m.tags,
      source: m.source,
      createdAt: m.createdAt,
    };
  }

  /** Read index.json; rebuild it from per-memory files if missing/unreadable. */
  private async readMemoryIndex(): Promise<MemoryIndexEntry[]> {
    const file = this.layout.memoryIndexFile();
    let raw: string | null = null;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (raw !== null) {
      try {
        return JSON.parse(raw) as MemoryIndexEntry[];
      } catch {
        // Corrupt index.json — fall through and rebuild from the per-memory files.
      }
    }
    const rebuilt = (await this.listMemories()).map((m) => this.toIndexEntry(m));
    await writeJson(file, rebuilt);
    return rebuilt;
  }

  /** Number of per-memory files on disk (excludes index.json). */
  private async countMemoryFiles(): Promise<number> {
    try {
      const names = await fs.readdir(this.layout.memoriesDir);
      return names.filter((f) => f.endsWith('.json') && f !== 'index.json')
        .length;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }
  }

  /**
   * Like readMemoryIndex, but also self-heals a STALE index: if the entry
   * count drifts from the number of memory files on disk, or the index
   * contains duplicate ids, rebuild it from the per-memory source of truth.
   */
  private async readReconciledIndex(): Promise<MemoryIndexEntry[]> {
    const index = await this.readMemoryIndex();
    const fileCount = await this.countMemoryFiles();
    const uniqueIds = new Set(index.map((e) => e.id));
    const drift = index.length !== fileCount || uniqueIds.size !== index.length;
    if (!drift) return index;
    const rebuilt = (await this.listMemories()).map((m) =>
      this.toIndexEntry(m),
    );
    await writeJson(this.layout.memoryIndexFile(), rebuilt);
    return rebuilt;
  }

  // --- Status helpers ---

  /** Workstreams whose status considers them not yet finished. */
  static isActiveStatus(status: WorkstreamStatus): boolean {
    return !['done', 'failed', 'cancelled'].includes(status);
  }
}
