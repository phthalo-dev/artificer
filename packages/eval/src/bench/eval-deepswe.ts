import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CACHE_DIR, RESULTS_DIR } from './config.js';

const execFileAsync = promisify(execFile);

interface Prediction {
  instance_id: string;
  model_patch: string;
}

interface EvalReport {
  run_id: string;
  resolved_instances: number;
  unresolved_instances: number;
  empty_patch_instances: number;
  error_instances: number;
  completed_instances: number;
  resolved_ids: string[];
  unresolved_ids: string[];
  empty_patch_ids: string[];
  error_ids: string[];
  completed_ids: string[];
  schema_version: number;
}

function parseTomlValue(raw: string, key: string): string | undefined {
  const m = raw.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m?.[1];
}

async function readPredictions(file: string): Promise<Prediction[]> {
  const raw = await fs.readFile(file, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Prediction);
}

async function gradeOne(
  instanceId: string,
  patch: string,
): Promise<'resolved' | 'unresolved' | 'empty_patch' | 'error'> {
  if (!patch.trim()) return 'empty_patch';

  const metaPath = path.join(CACHE_DIR, 'deepswe', instanceId, 'task.toml');
  let toml: string;
  try {
    toml = await fs.readFile(metaPath, 'utf8');
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`[deepswe-eval] skip ${instanceId}: task.toml not cached (run bench first)`);
    return 'error';
  }

  const image = parseTomlValue(toml, 'docker_image');
  const commit = parseTomlValue(toml, 'base_commit_hash');
  if (!image || !commit) {
    // eslint-disable-next-line no-console
    console.warn(`[deepswe-eval] skip ${instanceId}: missing docker_image or base_commit`);
    return 'error';
  }

  const tmp = await fs.mkdtemp(path.join('/tmp', 'deepswe-eval-'));
  const patchFile = path.join(tmp, 'model.patch');
  await fs.writeFile(patchFile, patch, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[deepswe-eval] grading ${instanceId} in ${image}`);

  const script = `
set -euo pipefail
cd /app
git config --global --add safe.directory /app 2>/dev/null || true
git reset --hard ${commit} >/dev/null 2>&1 || true
git apply --whitespace=nowarn /model.patch
if [ -f /tests/test.sh ]; then
  bash /tests/test.sh
elif [ -f /app/test.sh ]; then
  bash /app/test.sh base && bash /app/test.sh new
else
  exit 9
fi
`.trim();

  try {
    await execFileAsync(
      'docker',
      ['run', '--rm', '-v', `${patchFile}:/model.patch:ro`, image, 'bash', '-lc', script],
      { timeout: 1_800_000 },
    );
    return 'resolved';
  } catch {
    return 'unresolved';
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const resultsDir = process.env.BENCH_RESULTS_DIR ?? RESULTS_DIR;
  const predictionsPath = path.join(resultsDir, 'predictions.jsonl');
  const predictions = await readPredictions(predictionsPath);

  const report: EvalReport = {
    run_id: process.env.RUN_ID ?? 'artificer-deepswe',
    resolved_instances: 0,
    unresolved_instances: 0,
    empty_patch_instances: 0,
    error_instances: 0,
    completed_instances: 0,
    resolved_ids: [],
    unresolved_ids: [],
    empty_patch_ids: [],
    error_ids: [],
    completed_ids: [],
    schema_version: 2,
  };

  for (const p of predictions) {
    const verdict = await gradeOne(p.instance_id, p.model_patch);
    if (verdict === 'resolved') {
      report.resolved_ids.push(p.instance_id);
      report.completed_ids.push(p.instance_id);
    } else if (verdict === 'unresolved') {
      report.unresolved_ids.push(p.instance_id);
      report.completed_ids.push(p.instance_id);
    } else if (verdict === 'empty_patch') {
      report.empty_patch_ids.push(p.instance_id);
    } else {
      report.error_ids.push(p.instance_id);
    }
  }

  report.resolved_instances = report.resolved_ids.length;
  report.unresolved_instances = report.unresolved_ids.length;
  report.empty_patch_instances = report.empty_patch_ids.length;
  report.error_instances = report.error_ids.length;
  report.completed_instances = report.completed_ids.length;

  await fs.writeFile(
    path.join(resultsDir, 'eval-report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  // eslint-disable-next-line no-console
  console.log(
    `[deepswe-eval] resolved=${report.resolved_instances} ` +
      `unresolved=${report.unresolved_instances} -> ${path.join(resultsDir, 'eval-report.json')}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[deepswe-eval] fatal:', err);
  process.exit(1);
});
