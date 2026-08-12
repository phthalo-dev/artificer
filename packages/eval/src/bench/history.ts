import fs from 'node:fs/promises';
import path from 'node:path';
import { sumUsage } from '../driver/cost.js';
import type { AttemptRecord, BenchInstance, SuiteDefinition } from './types.js';
import type { BenchConfig } from './config.js';
import { suiteKind, suiteName } from './suites.js';

export interface BenchHistorySnapshot {
  id: string;
  archivedAt: string;
  suiteKind: 'swebench' | 'deepswe' | 'greenfield';
  suiteName: string;
  suitePath: string;
  modelName: string;
  models: BenchConfig['models'];
  instanceCount: number;
  resolvedCount: number | null;
  resolveRate: number | null;
  totalCostUsd: number;
  costPerSolvedUsd: number | null;
  avgCostUsd: number;
  totalRuns: number;
  inputTokens: number;
  outputTokens: number;
}

async function readEvalResolved(
  resultsDir: string,
  instanceIds: string[],
): Promise<{ resolved: number; resolveRate: number } | null> {
  try {
    const raw = await fs.readFile(path.join(resultsDir, 'eval-report.json'), 'utf8');
    const report = JSON.parse(raw) as { resolved_ids?: string[] };
    if (!report.resolved_ids) return null;
    const resolvedSet = new Set(report.resolved_ids);
    const resolved = instanceIds.filter((id) => resolvedSet.has(id)).length;
    return {
      resolved,
      resolveRate: instanceIds.length > 0 ? resolved / instanceIds.length : 0,
    };
  } catch {
    return null;
  }
}

/** Appends a summary snapshot after each bench run for cross-run efficiency charts. */
export async function archiveBenchRun(
  config: BenchConfig,
  suite: SuiteDefinition,
  instances: BenchInstance[],
  attempts: AttemptRecord[],
): Promise<void> {
  const historyDir = path.join(config.resultsDir, 'history');
  await fs.mkdir(historyDir, { recursive: true });

  const totals = sumUsage(attempts.map((a) => a.usage));
  const ids = instances.map((i) => i.instance_id);
  const graded = await readEvalResolved(config.resultsDir, ids);

  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot: BenchHistorySnapshot = {
    id,
    archivedAt: new Date().toISOString(),
    suiteKind: suiteKind(suite),
    suiteName: suiteName(suite, config.suitePath),
    suitePath: config.suitePath,
    modelName: config.modelName,
    models: config.models,
    instanceCount: attempts.length,
    resolvedCount: graded?.resolved ?? null,
    resolveRate: graded?.resolveRate ?? null,
    totalCostUsd: totals.costUsd,
    costPerSolvedUsd:
      graded && graded.resolved > 0 ? totals.costUsd / graded.resolved : null,
    avgCostUsd: attempts.length > 0 ? totals.costUsd / attempts.length : 0,
    totalRuns: totals.runs,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
  };

  await fs.writeFile(
    path.join(historyDir, `${id}.json`),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );
}

export async function readBenchHistory(
  resultsDir: string,
): Promise<BenchHistorySnapshot[]> {
  const historyDir = path.join(resultsDir, 'history');
  let files: string[];
  try {
    files = (await fs.readdir(historyDir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const snapshots: BenchHistorySnapshot[] = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(historyDir, file), 'utf8');
      snapshots.push(JSON.parse(raw) as BenchHistorySnapshot);
    } catch {
      // skip corrupt history entries
    }
  }
  snapshots.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  return snapshots;
}
