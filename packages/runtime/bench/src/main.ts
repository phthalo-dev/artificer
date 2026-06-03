import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { type BenchConfig, loadBenchConfig } from './config.js';
import { formatUsd, sumUsage } from './cost.js';
import { archiveBenchRun } from './history.js';
import { runInstance } from './run-instance.js';
import { startRuntime } from './runtime-process.js';
import {
  loadSuiteInstances,
  readSuite,
  suiteKind,
  suiteName,
} from './suites.js';
import type {
  AttemptRecord,
  BenchInstance,
  Prediction,
  SuiteDefinition,
} from './types.js';

async function selectInstances(
  config: BenchConfig,
): Promise<{ suite: SuiteDefinition; instances: BenchInstance[] }> {
  const suite = await readSuite(config.suitePath);
  const ids = config.instanceIds ?? suite.instanceIds;
  const instances = await loadSuiteInstances(suite, ids);
  const limited = config.limit ? instances.slice(0, config.limit) : instances;
  return { suite, instances: limited };
}

function evalHint(kind: ReturnType<typeof suiteKind>): string {
  return kind === 'deepswe'
    ? '`pnpm bench:eval:deepswe`, then `pnpm bench:report`'
    : '`pnpm bench:eval`, then `pnpm bench:report`';
}

/** Warn when Go gateway is paired with models that only exist on standard Zen. */
function warnGoModelMismatch(config: BenchConfig): void {
  const base = process.env.LLM_BASE_URL ?? '';
  if (!base.includes('/zen/go/')) return;
  const zenOnly = (id: string) =>
    id.startsWith('gpt-') || id.startsWith('gemini-') || id.startsWith('claude-');
  const bad = Object.entries(config.models).filter(([, id]) => zenOnly(id));
  if (bad.length === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[bench] warning: LLM_BASE_URL points at OpenCode Go but tier models look Zen-only: ` +
      bad.map(([tier, id]) => `${tier}=${id}`).join(', ') +
      `. Use a go-* preset and unset LLM_MODEL* in .env.`,
  );
}

async function main(): Promise<void> {
  const config = loadBenchConfig();
  const { suite, instances } = await selectInstances(config);
  const kind = suiteKind(suite);

  if (instances.length === 0) {
    // eslint-disable-next-line no-console
    console.error('[bench] no instances to run (check the suite / instance ids)');
    process.exit(1);
  }

  await fs.mkdir(config.resultsDir, { recursive: true });

  warnGoModelMismatch(config);

  // eslint-disable-next-line no-console
  console.log(
    `[bench] suite=${suiteName(suite, config.suitePath)} (${kind}) · ` +
      `${instances.length} instance(s) · models ` +
      `low=${config.models.low} medium=${config.models.medium} high=${config.models.high}`,
  );

  const attempts: AttemptRecord[] = [];
  const predictions: Prediction[] = [];

  let i = 0;
  for (const instance of instances) {
    i += 1;
    // eslint-disable-next-line no-console
    console.log(
      `\n[bench] (${i}/${instances.length}) ${instance.instance_id} — ${instance.repo}`,
    );

    let result;
    try {
      const runtime = await startRuntime(config, instance.instance_id);
      try {
        result = await runInstance(runtime, instance, config);
      } finally {
        await runtime.stop();
      }
    } catch (err) {
      result = {
        attempt: {
          instanceId: instance.instance_id,
          repo: instance.repo,
          baseCommit: instance.base_commit,
          outcome: 'error' as const,
          durationMs: 0,
          patchBytes: 0,
          error: err instanceof Error ? err.message : String(err),
        },
        prediction: {
          instance_id: instance.instance_id,
          model_name_or_path: config.modelName,
          model_patch: '',
        },
      };
    }

    attempts.push(result.attempt);
    predictions.push(result.prediction);

    const a = result.attempt;
    // eslint-disable-next-line no-console
    console.log(
      `[bench]   -> ${a.outcome} | ${(a.durationMs / 1000).toFixed(0)}s | ` +
        `patch ${a.patchBytes}B | ${a.usage ? formatUsd(a.usage.costUsd) : 'n/a'}` +
        `${a.usage ? ` | ${a.usage.runs} runs` : ''}` +
        `${a.learnCallCount != null ? ` | learn=${a.learnCallCount}` : ''}` +
        `${a.localRepoReady != null ? ` | repo=${a.localRepoReady}` : ''}`,
    );
    if ((a.learnCallCount ?? 0) > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[bench] warning: communicator invoked learn ${a.learnCallCount} time(s) on a repo task — ` +
          'expected 0 (use start_workstream instead).',
      );
    }

    await writeArtifacts(config, suite, instances, attempts, predictions);
  }

  await archiveBenchRun(config, suite, instances, attempts);

  printSummary(attempts);
  // eslint-disable-next-line no-console
  console.log(
    `\n[bench] wrote results to ${config.resultsDir}\n` +
      `[bench] next: grade correctness with ${evalHint(kind)}`,
  );
}

async function writeArtifacts(
  config: BenchConfig,
  suite: SuiteDefinition,
  instances: BenchInstance[],
  attempts: AttemptRecord[],
  predictions: Prediction[],
): Promise<void> {
  const predLines = predictions.map((p) => JSON.stringify(p)).join('\n');
  await fs.writeFile(
    path.join(config.resultsDir, 'predictions.jsonl'),
    `${predLines}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(config.resultsDir, 'attempts.json'),
    JSON.stringify(attempts, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(config.resultsDir, 'instances.json'),
    JSON.stringify(instances, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(config.resultsDir, 'run-config.json'),
    JSON.stringify(
      {
        ...config,
        suiteKind: suiteKind(suite),
        suiteName: suiteName(suite, config.suitePath),
        suiteDescription: suite.description ?? null,
        presetId: config.presetId ?? null,
        roleTiers: config.roleTiers,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function printSummary(attempts: AttemptRecord[]): void {
  const total = sumUsage(attempts.map((a) => a.usage));
  const byOutcome = attempts.reduce<Record<string, number>>((acc, a) => {
    acc[a.outcome] = (acc[a.outcome] ?? 0) + 1;
    return acc;
  }, {});
  const withPatch = attempts.filter((a) => a.patchBytes > 0).length;

  // eslint-disable-next-line no-console
  console.log('\n[bench] ===== driver summary (correctness pending eval) =====');
  // eslint-disable-next-line no-console
  console.log(`[bench] instances:        ${attempts.length}`);
  // eslint-disable-next-line no-console
  console.log(`[bench] produced a patch: ${withPatch}`);
  // eslint-disable-next-line no-console
  console.log(`[bench] outcomes:         ${JSON.stringify(byOutcome)}`);
  // eslint-disable-next-line no-console
  console.log(`[bench] total cost:       ${formatUsd(total.costUsd)}`);
  // eslint-disable-next-line no-console
  console.log(`[bench] total LLM calls:  ${total.runs}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bench] fatal:', err);
  process.exit(1);
});
