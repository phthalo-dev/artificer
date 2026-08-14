import fs from 'node:fs/promises';
import path from 'node:path';
import { evalResultsRoot } from './results-paths.js';

export interface EvalCompareSummary {
  resolvedDelta: number;
  costPerSolvedDeltaUsd: number | null;
  regressions: string[];
  improvements: string[];
}

export interface EvalCompareResult {
  baselineRunId: string;
  candidateRunId: string;
  summary: EvalCompareSummary;
}

interface EvalReportFile {
  resolved_ids?: string[];
  unresolved_ids?: string[];
}

interface ReportFile {
  summary?: {
    resolved?: number | null;
    costPerSolvedUsd?: number | null;
    totalCostUsd?: number;
  };
}

interface AttemptRecordLite {
  instanceId: string;
  usage?: { costUsd?: number };
}

export interface CompareEvalRunsOptions {
  /** When true, write compare.json next to the candidate run dir. */
  writeSidecar?: boolean;
  sidecarPath?: string;
}

/** Diff two eval run directories and return regression / improvement summary. */
export async function compareEvalRuns(
  baselineDir: string,
  candidateDir: string,
  options: CompareEvalRunsOptions = {},
): Promise<EvalCompareResult> {
  const baseline = path.resolve(baselineDir);
  const candidate = path.resolve(candidateDir);

  const [baselineResolved, candidateResolved] = await Promise.all([
    loadResolvedIds(baseline),
    loadResolvedIds(candidate),
  ]);
  const [baselineCost, candidateCost] = await Promise.all([
    loadCostPerSolved(baseline, baselineResolved.size),
    loadCostPerSolved(candidate, candidateResolved.size),
  ]);

  const regressions: string[] = [];
  const improvements: string[] = [];
  const allIds = new Set([...baselineResolved, ...candidateResolved]);
  // Also include unresolved from both so we catch baseline-only resolves.
  for (const id of await loadAttemptIds(baseline)) allIds.add(id);
  for (const id of await loadAttemptIds(candidate)) allIds.add(id);

  for (const id of [...allIds].sort()) {
    const wasResolved = baselineResolved.has(id);
    const isResolved = candidateResolved.has(id);
    if (wasResolved && !isResolved) regressions.push(id);
    if (!wasResolved && isResolved) improvements.push(id);
  }

  const result: EvalCompareResult = {
    baselineRunId: path.basename(baseline),
    candidateRunId: path.basename(candidate),
    summary: {
      resolvedDelta: candidateResolved.size - baselineResolved.size,
      costPerSolvedDeltaUsd:
        baselineCost !== null && candidateCost !== null
          ? candidateCost - baselineCost
          : null,
      regressions,
      improvements,
    },
  };

  if (options.writeSidecar || options.sidecarPath) {
    const out = options.sidecarPath ?? path.join(candidate, 'compare.json');
    await fs.writeFile(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  return result;
}

/**
 * Resolve baseline/candidate run dirs. When both args are omitted, uses the
 * two most recent directories under `execDir/evals/runs` (candidate = newest).
 */
export async function resolveCompareRunDirs(
  execDir: string,
  baselineArg?: string,
  candidateArg?: string,
): Promise<{ baselineDir: string; candidateDir: string }> {
  if (baselineArg && candidateArg) {
    return {
      baselineDir: await resolveRunArg(execDir, baselineArg),
      candidateDir: await resolveRunArg(execDir, candidateArg),
    };
  }

  if (baselineArg || candidateArg) {
    throw new Error(
      'Provide both baseline and candidate run paths, or omit both to compare the latest two runs',
    );
  }

  const runsDir = path.join(evalResultsRoot(execDir), 'runs');
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    throw new Error(`No eval runs found under ${runsDir}`);
  }

  const dirs: string[] = [];
  for (const name of entries) {
    const full = path.join(runsDir, name);
    try {
      const st = await fs.stat(full);
      if (st.isDirectory()) dirs.push(full);
    } catch {
      // skip
    }
  }
  dirs.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
  if (dirs.length < 2) {
    throw new Error(
      `Need at least two eval runs under ${runsDir} to compare (found ${dirs.length})`,
    );
  }

  return { candidateDir: dirs[0]!, baselineDir: dirs[1]! };
}

/** Format a compare result as a simple CLI table. */
export function formatCompareTable(result: EvalCompareResult): string {
  const { summary } = result;
  const costDelta =
    summary.costPerSolvedDeltaUsd === null
      ? 'n/a'
      : formatSignedUsd(summary.costPerSolvedDeltaUsd);
  const lines = [
    'Eval compare',
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Baseline | ${result.baselineRunId} |`,
    `| Candidate | ${result.candidateRunId} |`,
    `| Resolved Δ | ${formatSigned(summary.resolvedDelta)} |`,
    `| Cost/solved Δ | ${costDelta} |`,
    `| Regressions | ${summary.regressions.length ? summary.regressions.join(', ') : '(none)'} |`,
    `| Improvements | ${summary.improvements.length ? summary.improvements.join(', ') : '(none)'} |`,
    '',
  ];
  return lines.join('\n');
}

async function resolveRunArg(execDir: string, arg: string): Promise<string> {
  const asIs = path.resolve(arg);
  try {
    const st = await fs.stat(asIs);
    if (st.isDirectory()) return asIs;
  } catch {
    // fall through
  }

  const underRuns = path.resolve(evalResultsRoot(execDir), 'runs', arg);
  try {
    const st = await fs.stat(underRuns);
    if (st.isDirectory()) return underRuns;
  } catch {
    // fall through
  }

  // Allow "runs/<id>" relative forms from the spec examples.
  const stripped = arg.replace(/^[\\/]?runs[\\/]/, '');
  if (stripped !== arg) {
    const nested = path.resolve(evalResultsRoot(execDir), 'runs', stripped);
    try {
      const st = await fs.stat(nested);
      if (st.isDirectory()) return nested;
    } catch {
      // fall through
    }
  }

  throw new Error(`Eval run not found: ${arg}`);
}

async function loadResolvedIds(runDir: string): Promise<Set<string>> {
  const report = await readJson<EvalReportFile>(
    path.join(runDir, 'eval-report.json'),
  );
  if (report?.resolved_ids) return new Set(report.resolved_ids);

  const attempts = await readJson<AttemptRecordLite[]>(
    path.join(runDir, 'attempts.json'),
  );
  // Fallback: no graded report — treat nothing as resolved.
  void attempts;
  return new Set();
}

async function loadAttemptIds(runDir: string): Promise<string[]> {
  const attempts = await readJson<AttemptRecordLite[]>(
    path.join(runDir, 'attempts.json'),
  );
  return attempts?.map((a) => a.instanceId) ?? [];
}

async function loadCostPerSolved(
  runDir: string,
  resolvedCount: number,
): Promise<number | null> {
  const report = await readJson<ReportFile>(path.join(runDir, 'report.json'));
  if (
    report?.summary?.costPerSolvedUsd !== undefined &&
    report.summary.costPerSolvedUsd !== null
  ) {
    return report.summary.costPerSolvedUsd;
  }

  const attempts = await readJson<AttemptRecordLite[]>(
    path.join(runDir, 'attempts.json'),
  );
  if (!attempts || resolvedCount <= 0) return null;
  const total = attempts.reduce((sum, a) => sum + (a.usage?.costUsd ?? 0), 0);
  return total / resolvedCount;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

function formatSignedUsd(n: number): string {
  const abs = Math.abs(n);
  const body = `$${abs.toFixed(2)}`;
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}
