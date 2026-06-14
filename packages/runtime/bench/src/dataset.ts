import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_DIR } from './config.js';
import type { SweBenchInstance } from './types.js';

const DATASETS_SERVER = 'https://datasets-server.huggingface.co';
const PAGE_SIZE = 100;

interface RowsResponse {
  rows: { row: Record<string, unknown> }[];
  num_rows_total: number;
}

function cacheFile(dataset: string, split: string, config: string): string {
  const slug = `${dataset}__${config}__${split}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(CACHE_DIR, `${slug}.json`);
}

function toInstance(row: Record<string, unknown>): SweBenchInstance {
  return {
    instance_id: String(row.instance_id),
    repo: String(row.repo),
    base_commit: String(row.base_commit),
    problem_statement: String(row.problem_statement ?? ''),
    FAIL_TO_PASS: row.FAIL_TO_PASS != null ? String(row.FAIL_TO_PASS) : undefined,
    PASS_TO_PASS: row.PASS_TO_PASS != null ? String(row.PASS_TO_PASS) : undefined,
    version: row.version != null ? String(row.version) : undefined,
    environment_setup_commit:
      row.environment_setup_commit != null
        ? String(row.environment_setup_commit)
        : undefined,
  };
}

/** Reads the cached full-split dump if present. */
async function readCache(file: string): Promise<SweBenchInstance[] | undefined> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as SweBenchInstance[];
  } catch {
    return undefined;
  }
}

/**
 * Downloads every row of a dataset split from the HF datasets-server,
 * paging in chunks. Cached to disk so repeat runs are offline-friendly.
 */
async function fetchSplit(
  dataset: string,
  split: string,
  config: string,
): Promise<SweBenchInstance[]> {
  const file = cacheFile(dataset, split, config);
  const cached = await readCache(file);
  if (cached && cached.length > 0) return cached;

  const collected: SweBenchInstance[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url =
      `${DATASETS_SERVER}/rows?dataset=${encodeURIComponent(dataset)}` +
      `&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}` +
      `&offset=${offset}&length=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch dataset rows (${res.status} ${res.statusText}) from ${url}. ` +
          `If the dataset is gated or the server is rate-limiting, retry or pre-populate ${file}.`,
      );
    }
    const body = (await res.json()) as RowsResponse;
    total = body.num_rows_total;
    for (const r of body.rows) collected.push(toInstance(r.row));
    offset += PAGE_SIZE;
    if (body.rows.length === 0) break;
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(collected, null, 2), 'utf8');
  return collected;
}

/**
 * Loads the curated instances for a suite. Fetches the split (cached),
 * filters to the requested ids, preserves the requested order, and warns
 * about ids that are not present in the dataset.
 */
export async function loadInstances(
  dataset: string,
  split: string,
  config: string,
  instanceIds: string[],
): Promise<SweBenchInstance[]> {
  const all = await fetchSplit(dataset, split, config);
  const byId = new Map(all.map((i) => [i.instance_id, i]));

  const found: SweBenchInstance[] = [];
  const missing: string[] = [];
  for (const id of instanceIds) {
    const inst = byId.get(id);
    if (inst) found.push(inst);
    else missing.push(id);
  }

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bench] ${missing.length} instance id(s) not found in ${dataset} (${split}): ${missing.join(', ')}`,
    );
  }
  return found;
}
