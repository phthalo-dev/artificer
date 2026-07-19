import fs from 'node:fs/promises';
import path from 'node:path';
import type { Memory, MemoryKind, MemoryRelation } from './types.js';
import { MEMORY_KINDS } from './types.js';

export interface LearnBatchFact {
  content: string;
  title?: string;
  summary?: string;
  tags?: string[];
  source?: string;
  kind?: string;
  related?: MemoryRelation[];
}

export interface LearnBatchFile {
  batch: number;
  facts: LearnBatchFact[];
}

const KIND_ALIASES: Record<string, MemoryKind> = {
  decision: 'claim',
  assertion: 'claim',
  fact: 'note',
  pref: 'preference',
};

export function learnBatchDir(execRoot: string, runId: string): string {
  return path.join(execRoot, 'tmp', `learn-${runId}`);
}

export async function writeLearnBatch(
  execRoot: string,
  runId: string,
  batch: number,
  facts: LearnBatchFact[],
): Promise<string> {
  const dir = learnBatchDir(execRoot, runId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `batch-${String(batch).padStart(3, '0')}.json`);
  const payload: LearnBatchFile = { batch, facts };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');
  return file;
}

export async function listLearnBatchFiles(
  execRoot: string,
  runId: string,
): Promise<string[]> {
  const dir = learnBatchDir(execRoot, runId);
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((n) => /^batch-\d+\.json$/.test(n))
      .sort()
      .map((n) => path.join(dir, n));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

function normalizeKind(raw: string | undefined): MemoryKind {
  if (!raw) return 'note';
  const lower = raw.toLowerCase();
  if ((MEMORY_KINDS as readonly string[]).includes(lower)) {
    return lower as MemoryKind;
  }
  return KIND_ALIASES[lower] ?? 'note';
}

/**
 * Merge batch files: normalize kinds, case-insensitive entity-name dedupe,
 * drop related edges with empty ids. Does not validate target existence
 * (IdentityStore.addMemory does that).
 */
export async function mergeLearnBatches(
  execRoot: string,
  runId: string,
): Promise<Array<Omit<Memory, 'id' | 'createdAt'>>> {
  const files = await listLearnBatchFiles(execRoot, runId);
  const facts: LearnBatchFact[] = [];
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw) as LearnBatchFile;
    if (Array.isArray(parsed.facts)) facts.push(...parsed.facts);
  }

  const out: Array<Omit<Memory, 'id' | 'createdAt'>> = [];
  const entityNames = new Set<string>();

  for (const fact of facts) {
    if (!fact.content?.trim()) continue;
    const kind = normalizeKind(fact.kind);
    if (kind === 'entity') {
      const name = (fact.title ?? fact.summary ?? fact.content.slice(0, 40))
        .trim()
        .toLowerCase();
      if (entityNames.has(name)) continue;
      entityNames.add(name);
    }
    const related = (fact.related ?? []).filter((r) => r?.id);
    out.push({
      content: fact.content,
      title: fact.title,
      summary: fact.summary,
      tags: fact.tags ?? [],
      source: fact.source,
      kind,
      related: related.length ? related : undefined,
    });
  }
  return out;
}

export async function trashLearnBatches(
  execRoot: string,
  runId: string,
): Promise<void> {
  const dir = learnBatchDir(execRoot, runId);
  await fs.rm(dir, { recursive: true, force: true });
}

/** Default age-out for abandoned learn scratch dirs (24h). */
export const LEARN_BATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Remove `{exec}/tmp/learn-*` directories older than maxAgeMs.
 * Returns the number of directories removed.
 */
export async function ageOutLearnBatches(
  execRoot: string,
  maxAgeMs = LEARN_BATCH_MAX_AGE_MS,
  now = Date.now(),
): Promise<number> {
  const tmp = path.join(execRoot, 'tmp');
  let names: string[];
  try {
    names = await fs.readdir(tmp);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith('learn-')) continue;
    const dir = path.join(tmp, name);
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) continue;
      if (now - st.mtimeMs < maxAgeMs) continue;
      await fs.rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      // ignore races
    }
  }
  return removed;
}
