import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RESULTS_DIR } from './config.js';
import { GREENFIELD_FIXTURES_DIR, copyDir } from './greenfield.js';
import { CACHE_DIR } from './config.js';

const execFileAsync = promisify(execFile);

interface Prediction {
  instance_id: string;
  model_patch: string;
}

interface GreenfieldMeta {
  test_command: string;
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

async function readPredictions(file: string): Promise<Prediction[]> {
  const raw = await fs.readFile(file, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Prediction);
}

type Verdict = 'resolved' | 'unresolved' | 'empty_patch' | 'error';

async function gradeOne(instanceId: string, patch: string): Promise<Verdict> {
  if (!patch.trim()) return 'empty_patch';

  const scaffoldRepo = path.join(CACHE_DIR, 'greenfield', instanceId, 'repo');
  const fixtureDir = path.join(GREENFIELD_FIXTURES_DIR, instanceId);
  let meta: GreenfieldMeta;
  try {
    meta = JSON.parse(
      await fs.readFile(path.join(fixtureDir, 'meta.json'), 'utf8'),
    );
    await fs.access(scaffoldRepo);
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[greenfield-eval] skip ${instanceId}: scaffold not cached (run bench first)`,
    );
    return 'error';
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'greenfield-eval-'));
  const patchFile = path.join(tmp, 'model.patch');
  await fs.writeFile(patchFile, patch, 'utf8');
  const workdir = path.join(tmp, 'repo');

  // eslint-disable-next-line no-console
  console.log(`[greenfield-eval] grading ${instanceId}`);

  try {
    await execFileAsync('git', ['clone', '-q', scaffoldRepo, workdir]);
    await execFileAsync('git', ['apply', '--whitespace=nowarn', patchFile], {
      cwd: workdir,
    });
    await copyDir(path.join(fixtureDir, 'hidden'), workdir);
    await execFileAsync('sh', ['-c', meta.test_command], {
      cwd: workdir,
      timeout: 120_000,
    });
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
    run_id: process.env.RUN_ID ?? 'artificer-greenfield',
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
    `[greenfield-eval] resolved=${report.resolved_instances} ` +
      `unresolved=${report.unresolved_instances} -> ${path.join(resultsDir, 'eval-report.json')}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[greenfield-eval] fatal:', err);
  process.exit(1);
});
