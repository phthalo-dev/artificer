/**
 * Reads the benchmarking / identity-eval harness output and exposes it over
 * HTTP so the runtime UI can render a benchmark run page. This is a pure file
 * reader: the harness writes the artifacts; this module only assembles them.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RunNode, UsageSummary } from '../engine/cost.js';

/** Where the harness writes results; overridable for non-default layouts. */
export function benchResultsDir(): string {
  if (process.env.BENCH_RESULTS_DIR) {
    return path.resolve(process.env.BENCH_RESULTS_DIR);
  }
  const execDir = process.env.ARTIFICER_EXEC_DIR;
  if (execDir) {
    const latest = path.join(path.resolve(execDir), 'evals', 'latest');
    try {
      if (fs.statSync(latest).isDirectory()) return latest;
    } catch {
      // fall through
    }
  }
  return path.resolve(process.cwd(), 'bench/results');
}

// --- Shapes mirrored from bench/src/types.ts (kept local to stay decoupled) ---

interface AttemptRecord {
  instanceId: string;
  repo: string;
  baseCommit: string;
  outcome: string;
  messageId?: string;
  workstreamId?: string;
  workstreamStatus?: string;
  durationMs: number;
  patchBytes: number;
  usage?: UsageSummary;
  byRole?: Record<string, UsageSummary>;
  error?: string;
}

interface SweBenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
}

interface Prediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

interface RunConfig {
  models?: { low: string; medium: string; high: string };
  modelName?: string;
  instanceTimeoutMs?: number;
  maxRunsPerWorkstream?: number;
  suiteKind?: 'swebench' | 'deepswe' | 'greenfield';
  suiteName?: string;
  suiteDescription?: string | null;
  suitePath?: string;
}

interface BenchHistorySnapshot {
  id: string;
  archivedAt: string;
  suiteKind: 'swebench' | 'deepswe' | 'greenfield';
  suiteName: string;
  modelName: string;
  instanceCount: number;
  resolvedCount: number | null;
  resolveRate: number | null;
  totalCostUsd: number;
  avgCostUsd: number;
  costPerSolvedUsd: number | null;
}

export interface BenchSuiteCatalogEntry {
  id: string;
  kind: 'swebench' | 'deepswe' | 'greenfield';
  name: string;
  description?: string;
  taskCount: number;
  runCommand: string;
  evalCommand: string;
}

export interface BenchEfficiencyPoint {
  id: string;
  label: string;
  costUsd: number;
  scorePct: number;
  kind: 'instance' | 'run';
  resolved: boolean | null;
  isCurrent?: boolean;
}

interface EvalReport {
  resolved_ids?: string[];
  unresolved_ids?: string[];
  empty_patch_ids?: string[];
  error_ids?: string[];
}

/** Persisted per-instance trajectory written by the harness (runs/<id>.json). */
interface Trajectory {
  tree: RunNode[];
}

// --- UI response shapes ---

export interface BenchInstanceSummary {
  instanceId: string;
  repo: string;
  outcome: string;
  resolved: boolean | null;
  durationMs: number;
  patchBytes: number;
  costUsd: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  hasTrajectory: boolean;
}

export interface BenchOverview {
  generatedAt: string | null;
  graded: boolean;
  modelName: string | null;
  models: RunConfig['models'] | null;
  suiteKind: 'swebench' | 'deepswe' | 'greenfield' | null;
  suiteName: string | null;
  suiteDescription: string | null;
  summary: {
    instances: number;
    resolved: number | null;
    resolveRate: number | null;
    totalCostUsd: number;
    costPerSolvedUsd: number | null;
    avgCostUsd: number;
    totalRuns: number;
    inputTokens: number;
    outputTokens: number;
  };
  instances: BenchInstanceSummary[];
  /** Per-instance efficiency scatter for the current run. */
  instanceEfficiency: BenchEfficiencyPoint[];
  /** Archived run summaries for cross-run model comparison. */
  runEfficiency: BenchEfficiencyPoint[];
}

export type VerifierStatus =
  | 'resolved'
  | 'unresolved'
  | 'empty_patch'
  | 'error'
  | 'ungraded';

export interface BenchRunDetail {
  instanceId: string;
  repo: string;
  baseCommit: string;
  outcome: string;
  resolved: boolean | null;
  problemStatement: string | null;
  modelName: string | null;
  models: RunConfig['models'] | null;
  durationMs: number;
  patchBytes: number;
  usage: UsageSummary | null;
  byRole: Record<string, UsageSummary>;
  patch: string | null;
  verifier: { status: VerifierStatus; note: string | null };
  trajectory: RunNode[] | null;
}

const EMPTY_USAGE: UsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  requests: 0,
  runs: 0,
  costUsd: 0,
};

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function readPredictions(dir: string): Promise<Map<string, Prediction>> {
  const byId = new Map<string, Prediction>();
  try {
    const raw = await fsp.readFile(path.join(dir, 'predictions.jsonl'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const p = JSON.parse(trimmed) as Prediction;
        if (p.instance_id) byId.set(p.instance_id, p);
      } catch {
        // skip malformed prediction lines
      }
    }
  } catch {
    // no predictions yet
  }
  return byId;
}

function resolvedFor(
  evalReport: EvalReport | undefined,
  instanceId: string,
): boolean | null {
  if (!evalReport?.resolved_ids && !evalReport?.unresolved_ids) return null;
  if (evalReport.resolved_ids?.includes(instanceId)) return true;
  if (evalReport.unresolved_ids?.includes(instanceId)) return false;
  return null;
}

async function hasTrajectory(
  dir: string,
  instanceId: string,
): Promise<boolean> {
  try {
    await fsp.access(path.join(dir, 'runs', `${instanceId}.json`));
    return true;
  } catch {
    return false;
  }
}

async function readHistory(dir: string): Promise<BenchHistorySnapshot[]> {
  const historyDir = path.join(dir, 'history');
  let files: string[];
  try {
    files = (await fsp.readdir(historyDir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: BenchHistorySnapshot[] = [];
  for (const file of files) {
    try {
      out.push(
        JSON.parse(
          await fsp.readFile(path.join(historyDir, file), 'utf8'),
        ) as BenchHistorySnapshot,
      );
    } catch {
      // skip corrupt entries
    }
  }
  return out.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

/** Lists available identity eval suites for the UI catalog. */
export async function readBenchSuites(): Promise<BenchSuiteCatalogEntry[]> {
  const identityDir = process.env.ARTIFICER_IDENTITY_DIR ?? process.cwd();
  const suitesDir = path.join(
    path.resolve(identityDir),
    'agent',
    'evals',
    'suites',
  );
  let files: string[];
  try {
    files = (await fsp.readdir(suitesDir)).filter(
      (f) => f.endsWith('.json') && !f.startsWith('.'),
    );
  } catch {
    return [];
  }
  const entries: BenchSuiteCatalogEntry[] = [];
  for (const file of files.sort()) {
    try {
      const suite = JSON.parse(
        await fsp.readFile(path.join(suitesDir, file), 'utf8'),
      ) as {
        name?: string;
        description?: string;
        taskIds?: string[];
      };
      const id = path.basename(file, '.json');
      entries.push({
        id,
        kind: 'greenfield',
        name: suite.name ?? id,
        description: suite.description,
        taskCount: suite.taskIds?.length ?? 0,
        runCommand: `artificer eval run --suite ${id}`,
        evalCommand: `artificer eval run --suite ${id}`,
      });
    } catch {
      // skip invalid suite files
    }
  }
  return entries;
}

/** Assembles the list view: suite summary + one row per instance. */
export async function readBenchOverview(): Promise<BenchOverview | null> {
  const dir = benchResultsDir();
  const attempts = await readJson<AttemptRecord[]>(
    path.join(dir, 'attempts.json'),
  );
  if (!attempts) return null;

  const [config, evalReport] = await Promise.all([
    readJson<RunConfig>(path.join(dir, 'run-config.json')),
    readJson<EvalReport>(path.join(dir, 'eval-report.json')),
  ]);
  const reportMeta = await readJson<{ generatedAt?: string }>(
    path.join(dir, 'report.json'),
  );

  const instances: BenchInstanceSummary[] = [];
  for (const a of attempts) {
    const usage = a.usage ?? EMPTY_USAGE;
    instances.push({
      instanceId: a.instanceId,
      repo: a.repo,
      outcome: a.outcome,
      resolved: resolvedFor(evalReport, a.instanceId),
      durationMs: a.durationMs,
      patchBytes: a.patchBytes,
      costUsd: usage.costUsd,
      runs: usage.runs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      hasTrajectory: await hasTrajectory(dir, a.instanceId),
    });
  }

  const graded = Boolean(
    evalReport?.resolved_ids || evalReport?.unresolved_ids,
  );
  const resolved = graded
    ? instances.filter((i) => i.resolved === true).length
    : null;
  const totalCostUsd = instances.reduce((s, i) => s + i.costUsd, 0);
  const totalRuns = instances.reduce((s, i) => s + i.runs, 0);
  const history = await readHistory(dir);

  const instanceEfficiency: BenchEfficiencyPoint[] = instances.map((i) => ({
    id: i.instanceId,
    label: i.instanceId,
    costUsd: i.costUsd,
    scorePct: i.resolved === true ? 100 : i.resolved === false ? 0 : 50,
    kind: 'instance',
    resolved: i.resolved,
    isCurrent: true,
  }));

  const currentRunId = config?.modelName ?? 'current';
  const runEfficiency: BenchEfficiencyPoint[] = history
    .filter((h) => h.resolveRate !== null)
    .map((h) => ({
      id: h.id,
      label: `${h.modelName} · ${h.suiteName}`,
      costUsd: h.avgCostUsd,
      scorePct: Math.round((h.resolveRate ?? 0) * 100),
      kind: 'run' as const,
      resolved: null,
      isCurrent:
        h.modelName === config?.modelName && h.suiteName === config?.suiteName,
    }));

  // Ensure the active run appears even if history hasn't been written yet.
  if (
    resolved !== null &&
    instances.length > 0 &&
    !runEfficiency.some((p) => p.isCurrent)
  ) {
    runEfficiency.unshift({
      id: currentRunId,
      label: `${config?.modelName ?? 'runtime'} · ${config?.suiteName ?? 'suite'}`,
      costUsd: totalCostUsd / instances.length,
      scorePct: Math.round((resolved / instances.length) * 100),
      kind: 'run',
      resolved: null,
      isCurrent: true,
    });
  }

  return {
    generatedAt: reportMeta?.generatedAt ?? null,
    graded,
    modelName: config?.modelName ?? null,
    models: config?.models ?? null,
    suiteKind: config?.suiteKind ?? null,
    suiteName: config?.suiteName ?? null,
    suiteDescription: config?.suiteDescription ?? null,
    summary: {
      instances: instances.length,
      resolved,
      resolveRate:
        resolved !== null && instances.length > 0
          ? resolved / instances.length
          : null,
      totalCostUsd,
      costPerSolvedUsd:
        resolved && resolved > 0 ? totalCostUsd / resolved : null,
      avgCostUsd: instances.length > 0 ? totalCostUsd / instances.length : 0,
      totalRuns,
      inputTokens: instances.reduce((s, i) => s + i.inputTokens, 0),
      outputTokens: instances.reduce((s, i) => s + i.outputTokens, 0),
    },
    instances,
    instanceEfficiency,
    runEfficiency,
  };
}

function verifierStatus(
  outcome: string,
  resolved: boolean | null,
): { status: VerifierStatus; note: string | null } {
  if (resolved === true)
    return { status: 'resolved', note: 'All target tests pass.' };
  if (resolved === false)
    return { status: 'unresolved', note: 'Target tests still fail.' };
  if (outcome === 'empty_patch')
    return { status: 'empty_patch', note: 'The agent produced no patch.' };
  if (outcome === 'error' || outcome === 'failed')
    return { status: 'error', note: 'The run errored before grading.' };
  return {
    status: 'ungraded',
    note: 'Not yet graded — run `pnpm bench:eval`.',
  };
}

/** Assembles the detail view for a single instance. */
export async function readBenchRun(
  instanceId: string,
): Promise<BenchRunDetail | null> {
  const dir = benchResultsDir();
  const attempts = await readJson<AttemptRecord[]>(
    path.join(dir, 'attempts.json'),
  );
  const attempt = attempts?.find((a) => a.instanceId === instanceId);
  if (!attempt) return null;

  const [config, evalReport, instances, predictions, trajectory] =
    await Promise.all([
      readJson<RunConfig>(path.join(dir, 'run-config.json')),
      readJson<EvalReport>(path.join(dir, 'eval-report.json')),
      readJson<SweBenchInstance[]>(path.join(dir, 'instances.json')),
      readPredictions(dir),
      readJson<Trajectory>(path.join(dir, 'runs', `${instanceId}.json`)),
    ]);

  const instance = instances?.find((i) => i.instance_id === instanceId);
  const prediction = predictions.get(instanceId);
  const resolved = resolvedFor(evalReport, instanceId);

  return {
    instanceId: attempt.instanceId,
    repo: attempt.repo,
    baseCommit: attempt.baseCommit,
    outcome: attempt.outcome,
    resolved,
    problemStatement: instance?.problem_statement ?? null,
    modelName: config?.modelName ?? prediction?.model_name_or_path ?? null,
    models: config?.models ?? null,
    durationMs: attempt.durationMs,
    patchBytes: attempt.patchBytes,
    usage: attempt.usage ?? null,
    byRole: attempt.byRole ?? {},
    patch: prediction?.model_patch || null,
    verifier: verifierStatus(attempt.outcome, resolved),
    trajectory: trajectory?.tree ?? null,
  };
}
