import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  emptyGithubWatchState,
  type GithubWatchState,
} from '../engine/github-watch.js';
import {
  emptyScheduleRuntimeState,
  type ScheduleRuntimeState,
} from '../engine/schedules.js';
import {
  buildRunIndexEntry,
  isIndexableRunRole,
  rankRuns,
  type RunIndexEntry,
} from './history-search.js';
import { Layout } from './layout.js';
import { rankMemories, type MemoryIndexEntry } from './memory-search.js';
import {
  emptyUsage,
  type Finding,
  type Memory,
  type Message,
  type Review,
  type RunRecord,
  type Task,
  type Workstream,
  type WorkstreamStatus,
  type TraceMutation,
  type TraceMutationHandler,
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

/**
 * Per-file serialization for every operation that touches
 * `history/index.json` — both the read-modify-write cycle of an upsert and a
 * bare read (which can itself trigger a self-heal rebuild-write). `writeChains`
 * (via `writeJson`) only serializes the final write to a given path — it does
 * not guard the read that precedes it, so two concurrent operations on the
 * same file could both read a stale snapshot and the second write silently
 * clobbers the first, or a search's rebuild-write could race an upsert's
 * write. Keyed by file path (like `writeChains`) so unrelated `Store`
 * instances (different data dirs, e.g. in tests) never contend with each
 * other. See `Store.withHistoryIndexChain`.
 */
const historyIndexChains = new Map<string, Promise<void>>();

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, file);
}

async function writeJson(file: string, data: unknown): Promise<void> {
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => writeJsonAtomic(file, data));
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
 * Normalize a raw finding JSON object into a Finding, tolerating field-name
 * variants that external executors (e.g. cursor agent) may write. Maps
 * `author` → `role` and `summary`/`content` → `note`, and falls back to the
 * empty string for missing `createdAt` so sort comparisons never crash.
 */
function normalizeFinding(
  workstreamId: string,
  r: Record<string, unknown>,
): Finding {
  return {
    id:
      (r.id as string | undefined) ??
      String(r.note ?? r.summary ?? '').slice(0, 12),
    workstreamId,
    role: (r.role ?? r.author ?? 'worker') as string as Finding['role'],
    file: r.file as string | undefined,
    note: (r.note ?? r.summary ?? r.content ?? '') as string,
    createdAt: (r.createdAt as string | undefined) ?? '',
  };
}

/**
 * File-backed persistence for all runtime state. There is no database: every
 * message, workstream, task, review, run, and memory is a file on disk.
 */
export class Store {
  readonly layout: Layout;
  private traceHook?: TraceMutationHandler;

  /**
   * In-memory cache of the parsed history/index.json array. `Store` is the
   * sole writer of this file within one process, and every access to it is
   * already serialized through `withHistoryIndexChain`, so once populated
   * this cache can never go stale from an external writer — it's kept in
   * sync in place by every upsert instead of re-reading/re-parsing the
   * (potentially multi-MB) file from disk on every terminal saveRun. Only a
   * self-heal rebuild (missing/corrupt/wrong-shape index.json) repopulates
   * it from scratch.
   */
  private historyIndexCache: RunIndexEntry[] | null = null;

  constructor(execDir: string) {
    this.layout = new Layout(execDir);
  }

  setTraceHook(hook?: TraceMutationHandler): void {
    this.traceHook = hook;
  }

  private async recordTrace(mutation: TraceMutation): Promise<void> {
    if (!this.traceHook) return;
    await this.traceHook(mutation);
  }

  async init(): Promise<void> {
    await Promise.all([
      ensureDir(this.layout.messagesDir),
      ensureDir(this.layout.workstreamsDir),
      ensureDir(this.layout.runsDir),
      ensureDir(this.layout.memoriesDir),
      ensureDir(this.layout.workspaceDir),
      ensureDir(this.layout.tracesDir),
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
    if (message.workstreamId) {
      await this.recordTrace({
        workstreamId: message.workstreamId,
        kind: 'message',
        sourceId: message.id,
        at: message.createdAt,
        actor: {
          kind: message.direction === 'inbound' ? 'user' : 'agent',
        },
        data: {
          direction: message.direction,
          content: message.content,
        },
      });
    }
    return message;
  }

  async listMessages(): Promise<Message[]> {
    return listJson<Message>(this.layout.messagesDir);
  }

  async getMessage(id: string): Promise<Message | null> {
    const messages = await this.listMessages();
    return messages.find((message) => message.id === id) ?? null;
  }

  // --- Workstreams ---

  async createWorkstream(
    input: Pick<Workstream, 'title' | 'goal'> &
      Partial<
        Pick<
          Workstream,
          | 'driver'
          | 'repoId'
          | 'executor'
          | 'agentSessionId'
          | 'repoUrl'
          | 'baseCommit'
          | 'summary'
          | 'status'
          | 'submitPr'
        >
      >,
  ): Promise<Workstream> {
    const ts = now();
    const workstream: Workstream = {
      id: newId('ws'),
      traceId: newId('trace'),
      driver: input.driver,
      repoId: input.repoId,
      executor: input.executor,
      agentSessionId: input.agentSessionId,
      title: input.title,
      goal: input.goal,
      status: input.status ?? 'pending',
      summary: input.summary ?? '',
      repoUrl: input.repoUrl,
      baseCommit: input.baseCommit,
      submitPr: input.submitPr,
      createdAt: ts,
      updatedAt: ts,
    };
    await writeJson(this.layout.workstreamFile(workstream.id), workstream);
    await ensureDir(this.layout.workstreamWorkspace(workstream.id));
    await this.recordTrace({
      workstreamId: workstream.id,
      traceId: workstream.traceId,
      kind: 'workstream',
      sourceId: workstream.id,
      at: workstream.createdAt,
      data: { event: 'created', workstream },
    });
    return workstream;
  }

  async getWorkstream(id: string): Promise<Workstream | null> {
    return readJson<Workstream>(this.layout.workstreamFile(id));
  }

  async updateWorkstream(
    id: string,
    patch: Partial<
      Pick<
        Workstream,
        | 'status'
        | 'summary'
        | 'title'
        | 'driver'
        | 'repoId'
        | 'executor'
        | 'agentSessionId'
        | 'repoUrl'
        | 'baseCommit'
        | 'quotaPausedStatus'
        | 'channelContext'
      >
    >,
  ): Promise<Workstream | null> {
    const existing = await this.getWorkstream(id);
    if (!existing) return null;
    const updated: Workstream = { ...existing, ...patch, updatedAt: now() };
    await writeJson(this.layout.workstreamFile(id), updated);
    await this.recordTrace({
      workstreamId: updated.id,
      traceId: updated.traceId,
      kind: 'workstream',
      sourceId: updated.id,
      at: updated.updatedAt,
      data: {
        event: 'updated',
        patch,
        status: updated.status,
        updatedAt: updated.updatedAt,
      },
    });
    return updated;
  }

  /** Persist a stable trace id without emitting a trace mutation. */
  async persistTraceId(workstreamId: string, traceId: string): Promise<void> {
    const existing = await this.getWorkstream(workstreamId);
    if (!existing || existing.traceId) return;
    await writeJson(this.layout.workstreamFile(workstreamId), {
      ...existing,
      traceId,
    });
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

  async deleteWorkstream(id: string): Promise<void> {
    await Promise.all([
      fs.rm(this.layout.workstreamDir(id), { recursive: true, force: true }),
      fs.rm(this.layout.workstreamWorkspace(id), {
        recursive: true,
        force: true,
      }),
    ]);
  }

  // --- Plan artifact ---

  async writePlan(workstreamId: string, content: string): Promise<void> {
    const file = this.layout.planFile(workstreamId);
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, content, 'utf8');
    await this.recordTrace({
      workstreamId,
      kind: 'workstream',
      sourceId: workstreamId,
      data: {
        event: 'plan_written',
        content,
      },
    });
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
    await writeJson(this.layout.taskFile(task.workstreamId, task.id), task);
    await this.recordTrace({
      workstreamId: task.workstreamId,
      kind: 'task',
      sourceId: task.id,
      taskId: task.id,
      parentRunId: task.parentRunId,
      data: { event: 'created', task },
    });
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
    await this.recordTrace({
      workstreamId: updated.workstreamId,
      kind: 'task',
      sourceId: updated.id,
      taskId: updated.id,
      parentRunId: updated.parentRunId,
      data: { event: 'updated', task: updated },
    });
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
    await this.recordTrace({
      workstreamId: review.workstreamId,
      kind: 'review',
      sourceId: review.id,
      data: { event: 'created', review },
    });
    return review;
  }

  async listReviews(workstreamId: string): Promise<Review[]> {
    return listJson<Review>(this.layout.reviewsDir(workstreamId));
  }

  // --- Findings (the workstream blackboard's append-only shared notes) ---

  async createFinding(
    input: Pick<Finding, 'workstreamId' | 'role' | 'note'> &
      Partial<Pick<Finding, 'file'>>,
  ): Promise<Finding> {
    const finding: Finding = {
      id: newId('find'),
      createdAt: now(),
      ...input,
    };
    await writeJson(
      this.layout.findingFile(finding.workstreamId, finding.id),
      finding,
    );
    await this.recordTrace({
      workstreamId: finding.workstreamId,
      kind: 'finding',
      sourceId: finding.id,
      data: { event: 'created', finding },
    });
    return finding;
  }

  async listFindings(workstreamId: string): Promise<Finding[]> {
    const raw = await listJson<Record<string, unknown>>(
      this.layout.findingsDir(workstreamId),
    );
    return raw.map((r) => normalizeFinding(workstreamId, r));
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
          | 'routeProfileId'
          | 'routeAccountId'
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
      routeProfileId: input.routeProfileId,
      routeAccountId: input.routeAccountId,
      status: input.status ?? 'queued',
      toolCalls: [],
      usage: emptyUsage(),
      createdAt: now(),
    };
    await writeJson(this.layout.runFile(run.id), run);
    if (run.workstreamId) {
      await this.recordTrace({
        workstreamId: run.workstreamId,
        kind: 'run',
        sourceId: run.id,
        runId: run.id,
        parentRunId: run.parentRunId,
        taskId: run.taskId,
        data: {
          event: 'created',
          id: run.id,
          role: run.role,
          task: run.task,
          model: run.model,
          status: run.status,
          createdAt: run.createdAt,
        },
      });
    }
    return run;
  }

  async saveRun(run: RunRecord): Promise<void> {
    await writeJson(this.layout.runFile(run.id), run);
    // Only planner/worker/reviewer/librarian runs are search_history
    // candidates (see isIndexableRunRole) — communicator/orchestrator runs
    // never touch the history-index machinery at all, so routine chat/
    // routing traffic can't trigger a self-heal rebuild-write of
    // history/index.json for content that would never be indexed anyway.
    if (
      (run.status === 'done' || run.status === 'failed') &&
      isIndexableRunRole(run.role)
    ) {
      // Best-effort, fire-and-forget indexing (design constraint): an index
      // write failure (corrupt index.json, disk error, ...) must never fail
      // the run's own save or propagate up into the caller's error handling
      // — which, in engine/call.ts's executeCall, would otherwise flip an
      // already-successful run to 'failed' on its second saveRun call.
      try {
        await this.upsertHistoryIndexEntry(run);
      } catch (err) {
        console.error(`[history-index] failed to index run ${run.id}:`, err);
      }
    }
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
    related?: Memory['related'];
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
      related: input.related,
      createdAt,
      updatedAt: createdAt,
    };
    await writeJson(
      this.layout.memoryFile(memory.id, memory.createdAt),
      memory,
    );
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
    for (let i = 0; i < ranked.length; i++) {
      const m = await readJson<Memory>(
        this.layout.memoryFile(ranked[i].entry.id, ranked[i].entry.createdAt),
      );
      if (!m) continue;
      const remaining = charBudget - used;
      if (i === 0) {
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
      if (m.content.length > remaining) break;
      out.push(m);
      used += m.content.length;
    }
    return out;
  }

  /**
   * Search terminal run history (done/failed calls) by task/output text,
   * with optional role/workstream/status filters. Empty query returns the
   * most recent matches in recency order, same convention as queryMemories.
   */
  async searchHistory(
    query: string,
    opts: {
      role?: string;
      workstreamId?: string;
      status?: 'done' | 'failed';
      limit?: number;
    } = {},
  ): Promise<RunIndexEntry[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 5, 20));
    let entries = await this.withHistoryIndexChain(() =>
      this.readHistoryIndex(),
    );
    if (opts.role) entries = entries.filter((e) => e.role === opts.role);
    if (opts.workstreamId) {
      entries = entries.filter((e) => e.workstreamId === opts.workstreamId);
    }
    if (opts.status) entries = entries.filter((e) => e.status === opts.status);
    return rankRuns(query, entries)
      .slice(0, limit)
      .map((r) => r.entry);
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

  private toIndexEntry(m: Memory): MemoryIndexEntry {
    return {
      id: m.id,
      title: m.title,
      summary: m.summary,
      excerpt: m.content.slice(0, 200),
      tags: m.tags,
      source: m.source,
      kind: m.kind,
      related: m.related,
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
    const rebuilt = (await this.listMemories()).map((m) =>
      this.toIndexEntry(m),
    );
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

  /**
   * Read history/index.json; rebuild it from terminal runs/ files if missing,
   * unparseable, or parses to something that isn't an array (e.g. `null` or
   * `{}` — valid JSON but the wrong shape, which would otherwise silently
   * produce a non-array and make every later index operation throw forever,
   * since a *successful* parse never re-triggers this rebuild path on its
   * own). Unlike the memory index, no drift-count reconciliation is needed:
   * runs/ is written exclusively by Store's own createRun/saveRun, so there
   * is no external-mutation path that could cause the index to drift out
   * from under a valid, parseable index.json.
   *
   * Served from `historyIndexCache` once populated — see that field's doc
   * comment for why that's safe. Only the rebuild path below repopulates it.
   */
  private async readHistoryIndex(): Promise<RunIndexEntry[]> {
    if (this.historyIndexCache) return this.historyIndexCache;
    const file = this.layout.historyIndexFile();
    let raw: string | null = null;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.historyIndexCache = parsed as RunIndexEntry[];
          return this.historyIndexCache;
        }
        // Valid JSON but the wrong shape — fall through and rebuild from
        // runs/, same as a parse failure.
      } catch {
        // Corrupt index.json — fall through and rebuild from runs/.
      }
    }
    const runs = await this.listRuns();
    const rebuilt = runs
      .filter(
        (r) =>
          (r.status === 'done' || r.status === 'failed') &&
          isIndexableRunRole(r.role),
      )
      .map((r) => buildRunIndexEntry(r));
    await writeJson(file, rebuilt);
    this.historyIndexCache = rebuilt;
    return rebuilt;
  }

  /**
   * Serialize an operation against `history/index.json` behind the per-file
   * chain in `historyIndexChains`, so it can never interleave with another
   * concurrent operation on the same file. Every *external* entry point that
   * touches the history index — including a bare read, since
   * `readHistoryIndex()` can itself trigger a self-heal rebuild-write when
   * the index is missing or corrupt — must route through this helper (see
   * `searchHistory`, `upsertHistoryIndexEntry`). Otherwise a concurrent
   * self-heal rebuild-write (triggered by a read, e.g. from `searchHistory`)
   * could race a concurrent upsert's read-modify-write and silently drop an
   * entry.
   *
   * This helper is NOT reentrant: it must not be called again from inside a
   * callback it is already running, or the inner call would await a chain
   * link that can only resolve after itself, deadlocking. That's exactly why
   * `upsertHistoryIndexEntry` calls `readHistoryIndex()` directly instead of
   * wrapping it in another `withHistoryIndexChain` call — it's already
   * running inside one.
   */
  private async withHistoryIndexChain<T>(fn: () => Promise<T>): Promise<T> {
    const file = this.layout.historyIndexFile();
    const prev = historyIndexChains.get(file) ?? Promise.resolve();
    let result!: T;
    const next = prev
      .catch(() => {})
      .then(async () => {
        result = await fn();
      });
    historyIndexChains.set(file, next);
    await next;
    return result;
  }

  /**
   * Read-modify-write the history index for one run, serialized against any
   * other concurrent operation on the same file (see `withHistoryIndexChain`)
   * so concurrent terminal `saveRun` calls (the scheduler runs up to
   * `config.concurrency` runs in parallel) — and concurrent `searchHistory`
   * reads that might trigger a self-heal rebuild — can never race each
   * other and silently drop an entry.
   *
   * Only `planner`/`worker`/`reviewer`/`librarian` runs are indexed (see
   * `isIndexableRunRole`) — `communicator`/`orchestrator` runs are never
   * work-outcome history, so a terminal run of one of those roles removes
   * any existing entry instead (defensive; in practice one should never
   * exist) rather than adding one.
   */
  private async upsertHistoryIndexEntry(run: RunRecord): Promise<void> {
    await this.withHistoryIndexChain(async () => {
      const index = await this.readHistoryIndex();
      const i = index.findIndex((e) => e.id === run.id);
      if (!isIndexableRunRole(run.role)) {
        if (i === -1) return;
        index.splice(i, 1);
        await writeJson(this.layout.historyIndexFile(), index);
        this.historyIndexCache = index;
        return;
      }
      const entry = buildRunIndexEntry(run);
      if (i === -1) index.push(entry);
      else index[i] = entry;
      await writeJson(this.layout.historyIndexFile(), index);
      this.historyIndexCache = index;
    });
  }

  // --- GitHub watch state ---

  async readGithubWatchState(): Promise<GithubWatchState> {
    const state = await readJson<GithubWatchState>(
      this.layout.githubWatchStateFile(),
    );
    return state ?? emptyGithubWatchState();
  }

  async writeGithubWatchState(state: GithubWatchState): Promise<void> {
    await writeJson(this.layout.githubWatchStateFile(), state);
  }

  // --- Schedule state ---

  async readScheduleState(): Promise<ScheduleRuntimeState> {
    const state = await readJson<ScheduleRuntimeState>(
      this.layout.scheduleStateFile(),
    );
    return state ?? emptyScheduleRuntimeState();
  }

  async writeScheduleState(state: ScheduleRuntimeState): Promise<void> {
    await writeJson(this.layout.scheduleStateFile(), state);
  }

  // --- Status helpers ---

  /** Workstreams whose status considers them not yet finished. */
  static isActiveStatus(status: WorkstreamStatus): boolean {
    return !['done', 'failed', 'cancelled'].includes(status);
  }
}
