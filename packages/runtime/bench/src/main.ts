import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { BENCH_DIR, type BenchConfig, loadBenchConfig, RUNTIME_ROOT } from './config.js';
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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function runStep(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: RUNTIME_ROOT, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

/** Grade correctness and (re)generate the report, right after the driver run finishes. */
async function gradeAndReport(
  config: BenchConfig,
  kind: ReturnType<typeof suiteKind>,
): Promise<void> {
  const runId = (config.modelName ?? 'artificer-bench').replace(/\//g, '-');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BENCH_RESULTS_DIR: config.resultsDir,
    RUN_ID: runId,
  };

  // eslint-disable-next-line no-console
  console.log(`\n[bench] grading with the ${kind} evaluator...`);
  if (kind === 'swebench') {
    const venvPython = path.join(BENCH_DIR, 'eval', '.venv', 'bin', 'python');
    const python = (await fileExists(venvPython)) ? venvPython : 'python';
    await runStep('bash', [path.join(BENCH_DIR, 'eval', 'run-eval.sh')], {
      ...env,
      RESULTS_DIR: config.resultsDir,
      PYTHON: python,
    });
  } else if (kind === 'deepswe') {
    await runStep('bash', [path.join(BENCH_DIR, 'eval', 'run-deepswe-eval.sh')], env);
  } else {
    await runStep('bash', [path.join(BENCH_DIR, 'eval', 'run-greenfield-eval.sh')], env);
  }

  // eslint-disable-next-line no-console
  console.log(`\n[bench] writing report...`);
  await runStep('pnpm', ['exec', 'tsx', path.join(BENCH_DIR, 'src', 'report.ts')], env);
}

/** Warn when Go gateway is paired with models that only exist on standard Zen. */
function warnGoModelMismatch(config: BenchConfig): void {
  const base = config.baseUrl ?? process.env.LLM_BASE_URL ?? '';
  if (!base.includes('/zen/go/')) return;
  const zenOnly = (id: string) =>
    id.startsWith('gpt-') || id.startsWith('gemini-') || id.startsWith('claude-');
  const bad = Object.entries(config.models).filter(([, id]) => zenOnly(id));
  if (bad.length === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[bench] warning: gateway points at OpenCode Go but tier models look Zen-only: ` +
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

  const gatewayLabel = config.gateway
    ? `${config.gateway} (${config.baseUrl})`
    : (process.env.LLM_BASE_URL ?? 'default');
  // eslint-disable-next-line no-console
  console.log(
    `[bench] suite=${suiteName(suite, config.suitePath)} (${kind}) · ` +
      `${instances.length} instance(s) · gateway=${gatewayLabel} · models ` +
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

    if (config.instanceDelayMs > 0 && i < instances.length) {
      // eslint-disable-next-line no-console
      console.log(
        `[bench]   pausing ${(config.instanceDelayMs / 1000).toFixed(0)}s before next instance...`,
      );
      await sleep(config.instanceDelayMs);
    }
  }

  await archiveBenchRun(config, suite, instances, attempts);

  printSummary(attempts);
  // eslint-disable-next-line no-console
  console.log(`\n[bench] wrote results to ${config.resultsDir}`);

  await gradeAndReport(config, kind);
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
  // Exclude apiKey from persisted run-config (don't write secrets to disk).
  const { apiKey: _apiKey, ...safeConfig } = config;
  await fs.writeFile(
    path.join(config.resultsDir, 'run-config.json'),
    JSON.stringify(
      {
        ...safeConfig,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bench] fatal:', err);
  process.exit(1);
});
