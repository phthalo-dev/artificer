import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type {
  TraceEvent,
  TraceMutation,
  TraceRecord,
  Workstream,
  WorkstreamStatus,
} from './types.js';
import { Layout } from './layout.js';

const traceChains = new Map<string, Promise<void>>();
const MAX_STRING_LENGTH = 4_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_DEPTH = 5;

export interface TraceSink {
  ensureTrace(
    trace: TraceRecord,
  ): Promise<{ externalId: string; url?: string }>;
  appendEvents(trace: TraceRecord, events: TraceEvent[]): Promise<void>;
  publishReceipt?(trace: TraceRecord, receipt: unknown): Promise<void>;
  publishArtifact?(trace: TraceRecord, artifact: unknown): Promise<void>;
}

export interface TraceListOptions {
  limit?: number;
}

export interface TraceEventRange {
  offset?: number;
  limit?: number;
}

function now(): string {
  return new Date().toISOString();
}

function newTraceEventId(): string {
  return `evt_${randomUUID().slice(0, 12)}`;
}

function safeComponent(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function truncate(value: string, max = MAX_STRING_LENGTH): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function redactString(value: string): string {
  return truncate(
    value
      .replace(
        /\b(?:sk|ghp|github_pat|xoxb|xoxp|trk)_[A-Za-z0-9_-]+\b/gi,
        '[REDACTED]',
      )
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(
        /\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
        (match) => `${match.slice(0, match.search(/[:=]/) + 1)}[REDACTED]`,
      ),
  );
}

function isSensitiveKey(key: string): boolean {
  return /api[_-]?key|token|password|secret|authorization|credential/i.test(
    key,
  );
}

function projectValue(value: unknown, key = '', depth = 0): unknown {
  if (isSensitiveKey(key)) return '[REDACTED]';
  if (depth > MAX_OBJECT_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => projectValue(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[childKey] = projectValue(childValue, childKey, depth + 1);
    }
    return result;
  }
  return String(value);
}

function projectData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return (projectValue(data ?? {}) as Record<string, unknown>) ?? {};
}

function traceIdFor(workstreamId: string, traceId?: string): string {
  return traceId ?? `trace_${workstreamId}`;
}

function workstreamTraceData(workstream: Workstream): Record<string, unknown> {
  return {
    id: workstream.id,
    traceId: workstream.traceId,
    title: workstream.title,
    goal: workstream.goal,
    status: workstream.status,
    summary: workstream.summary,
    repoUrl: workstream.repoUrl,
    baseCommit: workstream.baseCommit,
    submitPr: workstream.submitPr,
    createdAt: workstream.createdAt,
    updatedAt: workstream.updatedAt,
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(temporary, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      return null;
    }
    throw error;
  }
}

async function withTraceChain<T>(
  traceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = traceChains.get(traceId) ?? Promise.resolve();
  let result!: T;
  const next = previous
    .catch(() => {})
    .then(async () => {
      result = await fn();
    });
  traceChains.set(traceId, next);
  await next;
  return result;
}

function recordFromWorkstream(
  workstream: Workstream,
  agentName: string,
): TraceRecord {
  const traceId = traceIdFor(workstream.id, workstream.traceId);
  return {
    schemaVersion: 1,
    id: traceId,
    workstreamId: workstream.id,
    agentName,
    title: workstream.title,
    goal: workstream.goal,
    status: workstream.status,
    summary: workstream.summary,
    createdAt: workstream.createdAt,
    updatedAt: workstream.updatedAt,
    repo: {
      remoteUrl: workstream.repoUrl,
      baseCommit: workstream.baseCommit,
    },
    eventCount: 0,
    lastSequence: 0,
  };
}

function recordFromMutation(
  mutation: TraceMutation,
  agentName: string,
): TraceRecord {
  const data = mutation.data ?? {};
  const source = (data.workstream ?? data) as Record<string, unknown>;
  const status =
    typeof source.status === 'string'
      ? (source.status as WorkstreamStatus)
      : 'pending';
  const title =
    typeof source.title === 'string'
      ? source.title
      : `Workstream ${mutation.workstreamId}`;
  const traceId = traceIdFor(mutation.workstreamId, mutation.traceId);
  const createdAt =
    typeof source.createdAt === 'string'
      ? source.createdAt
      : (mutation.at ?? now());
  return {
    schemaVersion: 1,
    id: traceId,
    workstreamId: mutation.workstreamId,
    originMessageId:
      typeof source.originMessageId === 'string'
        ? source.originMessageId
        : mutation.kind === 'message' && mutation.actor?.kind === 'user'
          ? mutation.sourceId
          : undefined,
    agentName,
    title,
    goal: typeof source.goal === 'string' ? source.goal : undefined,
    status,
    summary: typeof source.summary === 'string' ? source.summary : undefined,
    createdAt,
    updatedAt:
      typeof source.updatedAt === 'string' ? source.updatedAt : createdAt,
    repo: {
      remoteUrl:
        typeof source.repoUrl === 'string' ? source.repoUrl : undefined,
      baseCommit:
        typeof source.baseCommit === 'string' ? source.baseCommit : undefined,
    },
    eventCount: 0,
    lastSequence: 0,
  };
}

function updateRecordFromMutation(
  record: TraceRecord,
  mutation: TraceMutation,
): TraceRecord {
  const source = (mutation.data?.workstream ?? mutation.data) as
    | Record<string, unknown>
    | undefined;
  if (!source || typeof source !== 'object') return record;

  const next = { ...record };
  if (typeof source.title === 'string') next.title = source.title;
  if (typeof source.goal === 'string') next.goal = source.goal;
  if (typeof source.summary === 'string') next.summary = source.summary;
  if (typeof source.status === 'string') {
    next.status = source.status as WorkstreamStatus;
  }
  if (typeof source.createdAt === 'string') next.createdAt = source.createdAt;
  if (typeof source.updatedAt === 'string') next.updatedAt = source.updatedAt;
  if (
    typeof source.repoUrl === 'string' ||
    typeof source.baseCommit === 'string'
  ) {
    next.repo = {
      ...next.repo,
      ...(typeof source.repoUrl === 'string'
        ? { remoteUrl: source.repoUrl }
        : {}),
      ...(typeof source.baseCommit === 'string'
        ? { baseCommit: source.baseCommit }
        : {}),
    };
  }
  if (typeof source.originMessageId === 'string') {
    next.originMessageId = source.originMessageId;
  } else if (
    !next.originMessageId &&
    mutation.kind === 'message' &&
    mutation.actor?.kind === 'user' &&
    mutation.sourceId
  ) {
    next.originMessageId = mutation.sourceId;
  }
  return next;
}

export class TraceRecorder {
  constructor(
    private readonly layout: Layout,
    private readonly agentName: string,
    private readonly sink?: TraceSink,
  ) {}

  async ensureForWorkstream(workstream: Workstream): Promise<TraceRecord> {
    const traceId = traceIdFor(workstream.id, workstream.traceId);
    return withTraceChain(traceId, () =>
      this.ensureRecordLocked(
        traceId,
        recordFromWorkstream(workstream, this.agentName),
      ),
    );
  }

  async record(mutation: TraceMutation): Promise<TraceEvent | null> {
    const traceId = await this.resolveTraceId(mutation);
    const normalizedMutation = { ...mutation, traceId };
    return withTraceChain(traceId, async () => {
      const trace = await this.ensureRecordLocked(
        traceId,
        recordFromMutation(normalizedMutation, this.agentName),
      );
      const event: TraceEvent = {
        schemaVersion: 1,
        id: newTraceEventId(),
        traceId,
        sequence: trace.lastSequence + 1,
        at: normalizedMutation.at ?? now(),
        kind: normalizedMutation.kind,
        sourceId: normalizedMutation.sourceId,
        runId: normalizedMutation.runId,
        parentRunId: normalizedMutation.parentRunId,
        taskId: normalizedMutation.taskId,
        actor: normalizedMutation.actor,
        data: projectData(normalizedMutation.data),
      };

      await ensureDir(this.layout.traceDir(traceId));
      await fs.appendFile(
        this.layout.traceEventsFile(traceId),
        `${JSON.stringify(event)}\n`,
        'utf8',
      );

      const updated: TraceRecord = {
        ...updateRecordFromMutation(trace, normalizedMutation),
        eventCount: trace.eventCount + 1,
        lastSequence: event.sequence,
        updatedAt: event.at,
      };
      await writeJsonAtomic(this.layout.traceFile(traceId), updated);

      if (this.sink) {
        try {
          await this.sink.appendEvents(updated, [event]);
        } catch (error) {
          console.error('[trace] sink append failed:', error);
        }
      }
      return event;
    });
  }

  async backfill(workstreams: Workstream[]): Promise<void> {
    for (const workstream of workstreams) {
      const traceId = traceIdFor(workstream.id, workstream.traceId);
      await withTraceChain(traceId, async () => {
        const trace = await this.ensureRecordLocked(
          traceId,
          recordFromWorkstream(workstream, this.agentName),
        );
        const stats = await this.scanEvents(traceId);
        if (stats.count > 0) return;

        const mutation: TraceMutation = {
          workstreamId: workstream.id,
          traceId,
          kind: 'workstream',
          sourceId: workstream.id,
          at: workstream.createdAt,
          data: {
            event: 'backfilled',
            backfilled: true,
            workstream: workstreamTraceData(workstream),
          },
        };
        const event: TraceEvent = {
          schemaVersion: 1,
          id: newTraceEventId(),
          traceId,
          sequence: 1,
          at: workstream.createdAt,
          kind: mutation.kind,
          sourceId: mutation.sourceId,
          data: projectData(mutation.data),
        };
        await ensureDir(this.layout.traceDir(traceId));
        await fs.appendFile(
          this.layout.traceEventsFile(traceId),
          `${JSON.stringify(event)}\n`,
          'utf8',
        );
        await writeJsonAtomic(this.layout.traceFile(traceId), {
          ...updateRecordFromMutation(trace, mutation),
          backfilled: true,
          eventCount: 1,
          lastSequence: 1,
          updatedAt: event.at,
        });
      });
    }
  }

  async reconcile(traceIdInput: string): Promise<TraceRecord | null> {
    const traceId = safeComponent(traceIdInput, 'trace ID');
    return withTraceChain(traceId, async () => {
      const trace = await readJson<TraceRecord>(this.layout.traceFile(traceId));
      if (!trace) return null;
      const stats = await this.scanEvents(traceId);
      if (
        trace.eventCount === stats.count &&
        trace.lastSequence === stats.lastSequence
      ) {
        return trace;
      }
      const repaired = {
        ...trace,
        eventCount: stats.count,
        lastSequence: stats.lastSequence,
        updatedAt: now(),
      };
      await writeJsonAtomic(this.layout.traceFile(traceId), repaired);
      return repaired;
    });
  }

  async get(traceIdInput: string): Promise<TraceRecord | null> {
    const traceId = safeComponent(traceIdInput, 'trace ID');
    return readJson<TraceRecord>(this.layout.traceFile(traceId));
  }

  async list(options: TraceListOptions = {}): Promise<TraceRecord[]> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
    let entries;
    try {
      entries = await fs.readdir(this.layout.tracesDir, {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const records: TraceRecord[] = [];
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        entry.name === 'outbox'
      )
        continue;
      if (!/^[A-Za-z0-9._-]+$/.test(entry.name)) continue;
      const record = await readJson<TraceRecord>(
        this.layout.traceFile(entry.name),
      );
      if (record) records.push(record);
    }
    return records
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async listEvents(
    traceIdInput: string,
    range: TraceEventRange = {},
  ): Promise<TraceEvent[]> {
    const traceId = safeComponent(traceIdInput, 'trace ID');
    const offset = Math.max(range.offset ?? 0, 0);
    const limit = Math.min(Math.max(range.limit ?? 100, 1), 200);
    const events: TraceEvent[] = [];
    let index = 0;
    let malformedLine: number | undefined;

    try {
      const stream = createReadStream(this.layout.traceEventsFile(traceId), {
        encoding: 'utf8',
      });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          index += 1;
          let parsed: TraceEvent;
          try {
            parsed = JSON.parse(line) as TraceEvent;
          } catch (error) {
            if (malformedLine !== undefined) throw error;
            malformedLine = index;
            continue;
          }
          if (malformedLine !== undefined) {
            throw new Error(
              `Malformed trace event line ${malformedLine} in ${traceId}`,
            );
          }
          if (parsed.traceId !== traceId) {
            throw new Error(
              `Trace event ${parsed.id} belongs to another trace`,
            );
          }
          if (index <= offset) continue;
          events.push(parsed);
          if (events.length >= limit) break;
        }
      } finally {
        lines.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    // A malformed final line is ignored intentionally. A malformed line
    // followed by another valid event is surfaced above instead.
    return events;
  }

  private async resolveTraceId(mutation: TraceMutation): Promise<string> {
    if (mutation.traceId) return mutation.traceId;
    const workstream = await readJson<Workstream>(
      this.layout.workstreamFile(mutation.workstreamId),
    );
    return traceIdFor(mutation.workstreamId, workstream?.traceId);
  }

  private async ensureRecordLocked(
    traceId: string,
    fallback: TraceRecord,
  ): Promise<TraceRecord> {
    safeComponent(traceId, 'trace ID');
    const existing = await readJson<TraceRecord>(
      this.layout.traceFile(traceId),
    );
    if (existing) return existing;
    await ensureDir(this.layout.traceDir(traceId));
    await writeJsonAtomic(this.layout.traceFile(traceId), fallback);
    return fallback;
  }

  private async scanEvents(
    traceIdInput: string,
  ): Promise<{ count: number; lastSequence: number }> {
    const traceId = safeComponent(traceIdInput, 'trace ID');
    let count = 0;
    let lastSequence = 0;
    let malformedLine: number | undefined;

    try {
      const stream = createReadStream(this.layout.traceEventsFile(traceId), {
        encoding: 'utf8',
      });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          count += 1;
          let parsed: TraceEvent;
          try {
            parsed = JSON.parse(line) as TraceEvent;
          } catch (error) {
            if (malformedLine !== undefined) throw error;
            malformedLine = count;
            continue;
          }
          if (malformedLine !== undefined) {
            throw new Error(
              `Malformed trace event line ${malformedLine} in ${traceId}`,
            );
          }
          if (parsed.traceId !== traceId) {
            throw new Error(
              `Trace event ${parsed.id} belongs to another trace`,
            );
          }
          lastSequence = Math.max(lastSequence, parsed.sequence);
        }
      } finally {
        lines.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { count: 0, lastSequence: 0 };
      }
      throw error;
    }

    if (malformedLine !== undefined) count -= 1;
    return { count, lastSequence };
  }
}
