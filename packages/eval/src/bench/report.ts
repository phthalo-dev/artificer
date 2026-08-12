import fs from 'node:fs/promises';
import path from 'node:path';
import { RESULTS_DIR } from './config.js';
import { formatUsd, sumUsage } from '../driver/cost.js';
import type { AttemptRecord, UsageSummary } from './types.js';

/** Shape of the official SWE-bench harness report (fields we consume). */
interface SweBenchReport {
  total_instances?: number;
  resolved_instances?: number;
  resolved_ids?: string[];
  unresolved_ids?: string[];
  empty_patch_ids?: string[];
  error_ids?: string[];
}

interface PerInstanceRow {
  instanceId: string;
  repo: string;
  resolved: boolean | null; // null when eval data is unavailable
  outcome: string;
  durationMs: number;
  patchBytes: number;
  costUsd: number;
  runs: number;
  // Recorded per instance (not just in the aggregate summary) so cost can be
  // recomputed later if a provider's per-token pricing changes.
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function rowFor(
  a: AttemptRecord,
  resolvedIds: Set<string> | undefined,
): PerInstanceRow {
  return {
    instanceId: a.instanceId,
    repo: a.repo,
    resolved: resolvedIds ? resolvedIds.has(a.instanceId) : null,
    outcome: a.outcome,
    durationMs: a.durationMs,
    patchBytes: a.patchBytes,
    costUsd: a.usage?.costUsd ?? 0,
    runs: a.usage?.runs ?? 0,
    inputTokens: a.usage?.inputTokens ?? 0,
    outputTokens: a.usage?.outputTokens ?? 0,
    cacheCreationInputTokens: a.usage?.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: a.usage?.cacheReadInputTokens ?? 0,
  };
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

function buildMarkdown(
  rows: PerInstanceRow[],
  totals: UsageSummary,
  resolvedCount: number | null,
): string {
  const n = rows.length;
  const solved = resolvedCount;
  const resolveRate =
    solved !== null && n > 0 ? `${((solved / n) * 100).toFixed(1)}%` : 'n/a (run eval)';
  const costPerSolved =
    solved && solved > 0 ? formatUsd(totals.costUsd / solved) : 'n/a';
  const avgRuns = n > 0 ? (totals.runs / n).toFixed(1) : '0';

  const lines: string[] = [];
  lines.push('# Runtime Benchmark Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Instances | ${n} |`);
  lines.push(`| Resolved | ${solved === null ? 'n/a (run eval)' : solved} |`);
  lines.push(`| Resolve rate | ${resolveRate} |`);
  lines.push(`| Total cost | ${formatUsd(totals.costUsd)} |`);
  lines.push(`| Cost per solved | ${costPerSolved} |`);
  lines.push(`| Total LLM calls | ${totals.runs} |`);
  lines.push(`| Avg calls / instance | ${avgRuns} |`);
  lines.push(
    `| Tokens (in / out) | ${totals.inputTokens.toLocaleString()} / ${totals.outputTokens.toLocaleString()} |`,
  );
  lines.push('');
  lines.push('## Per-instance');
  lines.push('');
  lines.push(
    '| Instance | Repo | Resolved | Outcome | Time | Patch | Cost | Calls | Tokens (in / out) |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const resolved =
      r.resolved === null ? '—' : r.resolved ? '✅' : '❌';
    lines.push(
      `| ${r.instanceId} | ${r.repo} | ${resolved} | ${r.outcome} | ` +
        `${fmtDuration(r.durationMs)} | ${r.patchBytes}B | ${formatUsd(r.costUsd)} | ${r.runs} | ` +
        `${r.inputTokens.toLocaleString()} / ${r.outputTokens.toLocaleString()} |`,
    );
  }
  lines.push('');
  if (solved === null) {
    lines.push(
      '> Correctness not yet graded. Run `pnpm bench:eval` then `pnpm bench:report`.',
    );
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const resultsDir = process.env.BENCH_RESULTS_DIR ?? RESULTS_DIR;

  const attempts = await readJson<AttemptRecord[]>(
    path.join(resultsDir, 'attempts.json'),
  );
  if (!attempts) {
    // eslint-disable-next-line no-console
    console.error(
      `[report] no attempts.json in ${resultsDir} (run \`pnpm bench\` first)`,
    );
    process.exit(1);
  }

  const evalReport = await readJson<SweBenchReport>(
    path.join(resultsDir, 'eval-report.json'),
  );
  const resolvedIds = evalReport?.resolved_ids
    ? new Set(evalReport.resolved_ids)
    : undefined;

  const rows = attempts.map((a) => rowFor(a, resolvedIds));
  const totals = sumUsage(attempts.map((a) => a.usage));
  const resolvedCount = resolvedIds
    ? rows.filter((r) => r.resolved).length
    : null;

  const reportJson = {
    generatedAt: new Date().toISOString(),
    graded: resolvedIds !== undefined,
    summary: {
      instances: rows.length,
      resolved: resolvedCount,
      resolveRate:
        resolvedCount !== null && rows.length > 0
          ? resolvedCount / rows.length
          : null,
      totalCostUsd: totals.costUsd,
      costPerSolvedUsd:
        resolvedCount && resolvedCount > 0
          ? totals.costUsd / resolvedCount
          : null,
      totalRuns: totals.runs,
      tokens: {
        input: totals.inputTokens,
        output: totals.outputTokens,
      },
    },
    instances: rows,
  };

  await fs.writeFile(
    path.join(resultsDir, 'report.json'),
    JSON.stringify(reportJson, null, 2),
    'utf8',
  );
  const md = buildMarkdown(rows, totals, resolvedCount);
  await fs.writeFile(path.join(resultsDir, 'report.md'), `${md}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(md);
  // eslint-disable-next-line no-console
  console.log(
    `\n[report] wrote ${path.join(resultsDir, 'report.json')} and report.md`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[report] fatal:', err);
  process.exit(1);
});
