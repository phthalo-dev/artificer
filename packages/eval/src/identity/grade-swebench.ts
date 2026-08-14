import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Prediction } from '../bench/types.js';
import type { EvalTaskResult } from '../types.js';

export interface SweBenchEvalReport {
  schema_version?: number;
  resolved_ids?: string[];
  unresolved_ids?: string[];
  empty_patch_ids?: string[];
  error_ids?: string[];
}

export function predictionsFromResults(
  results: EvalTaskResult[],
  modelName: string,
): Prediction[] {
  return results.map((result) => ({
    instance_id: result.instanceId,
    model_name_or_path: modelName,
    model_patch: result.patch ?? '',
  }));
}

export async function writePredictionsJsonl(
  resultsDir: string,
  predictions: Prediction[],
): Promise<string> {
  const file = path.join(resultsDir, 'predictions.jsonl');
  const body = predictions.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(file, body ? `${body}\n` : '', 'utf8');
  return file;
}

export function applySweBenchReport(
  results: EvalTaskResult[],
  report: SweBenchEvalReport,
): EvalTaskResult[] {
  const resolved = new Set(report.resolved_ids ?? []);
  const empty = new Set(report.empty_patch_ids ?? []);
  const errors = new Set(report.error_ids ?? []);
  return results.map((result) => {
    if (result.outcome === 'error' || result.outcome === 'timeout') {
      return result;
    }
    if (errors.has(result.instanceId)) {
      return { ...result, resolved: false, outcome: 'failed' };
    }
    if (empty.has(result.instanceId) || !result.patch?.trim()) {
      return { ...result, resolved: false, outcome: 'failed' };
    }
    if (resolved.has(result.instanceId)) {
      return { ...result, resolved: true, outcome: 'submitted' };
    }
    return { ...result, resolved: false, outcome: 'failed' };
  });
}

function sweBenchEvalScript(): string {
  const require = createRequire(import.meta.url);
  const runtimeRoot = path.dirname(
    require.resolve('@artificer-ai/runtime/package.json'),
  );
  return path.join(runtimeRoot, 'bench', 'eval', 'run-eval.sh');
}

/**
 * Runs the official SWE-bench harness when Docker + swebench are available.
 * Returns undefined when the script is missing or the process exits non-zero
 * so callers can leave tasks ungraded rather than failing the whole suite.
 */
export async function runSweBenchHarness(
  resultsDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SweBenchEvalReport | undefined> {
  const script = sweBenchEvalScript();
  try {
    await fs.access(script);
  } catch {
    return undefined;
  }

  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn('bash', [script], {
      env: {
        ...env,
        RESULTS_DIR: resultsDir,
        PREDICTIONS: path.join(resultsDir, 'predictions.jsonl'),
      },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) return undefined;

  try {
    const raw = await fs.readFile(
      path.join(resultsDir, 'eval-report.json'),
      'utf8',
    );
    return JSON.parse(raw) as SweBenchEvalReport;
  } catch {
    return undefined;
  }
}
