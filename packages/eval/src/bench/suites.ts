import fs from 'node:fs/promises';
import path from 'node:path';
import { TASKS_DIR } from './config.js';
import { loadDeepSweInstances } from './deepswe.js';
import { loadGreenfieldInstances } from './greenfield.js';
import { loadInstances } from './dataset.js';
import type { BenchInstance, SuiteDefinition } from './types.js';

export interface SuiteCatalogEntry {
  id: string;
  path: string;
  kind: 'swebench' | 'deepswe' | 'greenfield';
  name: string;
  description?: string;
  taskCount: number;
  runCommand: string;
  evalCommand: string;
}

export async function readSuite(suitePath: string): Promise<SuiteDefinition> {
  const raw = await fs.readFile(suitePath, 'utf8');
  return JSON.parse(raw) as SuiteDefinition;
}

export function suiteKind(suite: SuiteDefinition): 'swebench' | 'deepswe' | 'greenfield' {
  return suite.kind ?? 'swebench';
}

export function suiteName(suite: SuiteDefinition, suitePath: string): string {
  return suite.name ?? path.basename(suitePath, '.json');
}

/** Loads instances for either SWE-bench (HF) or DeepSWE (Harbor) suites. */
export async function loadSuiteInstances(
  suite: SuiteDefinition,
  instanceIds: string[],
): Promise<BenchInstance[]> {
  const kind = suiteKind(suite);
  if (kind === 'deepswe') {
    const instances = await loadDeepSweInstances(instanceIds);
    return instances;
  }
  if (kind === 'greenfield') {
    return loadGreenfieldInstances(instanceIds);
  }
  if (!suite.dataset || !suite.split) {
    throw new Error('SWE-bench suite requires dataset and split fields');
  }
  const rows = await loadInstances(
    suite.dataset,
    suite.split,
    suite.config ?? 'default',
    instanceIds,
  );
  return rows.map((row) => ({ ...row, suite: 'swebench' as const }));
}

/** Lists suite JSON files under bench/tasks for the UI catalog. */
export async function listSuiteCatalog(): Promise<SuiteCatalogEntry[]> {
  const files = (await fs.readdir(TASKS_DIR)).filter(
    (f) => f.endsWith('.json') && !f.startsWith('.'),
  );
  const entries: SuiteCatalogEntry[] = [];
  for (const file of files.sort()) {
    const suitePath = path.join(TASKS_DIR, file);
    const suite = await readSuite(suitePath);
    const kind = suiteKind(suite);
    const id = path.basename(file, '.json');
    entries.push({
      id,
      path: suitePath,
      kind,
      name: suiteName(suite, suitePath),
      description: suite.description,
      taskCount: suite.instanceIds.length,
      runCommand: `pnpm bench --suite tasks/${file}`,
      evalCommand:
        kind === 'deepswe'
          ? 'pnpm bench:eval:deepswe'
          : kind === 'greenfield'
            ? 'pnpm bench:eval:greenfield'
            : 'pnpm bench:eval',
    });
  }
  return entries;
}
