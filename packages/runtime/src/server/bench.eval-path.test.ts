import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'vitest';
import { benchResultsDir, readBenchSuites } from './bench.js';

const originalBenchResultsDir = process.env.BENCH_RESULTS_DIR;
const originalExecDir = process.env.ARTIFICER_EXEC_DIR;
const originalIdentityDir = process.env.ARTIFICER_IDENTITY_DIR;

afterEach(() => {
  setEnv('BENCH_RESULTS_DIR', originalBenchResultsDir);
  setEnv('ARTIFICER_EXEC_DIR', originalExecDir);
  setEnv('ARTIFICER_IDENTITY_DIR', originalIdentityDir);
});

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test('benchResultsDir prefers the explicit maintainer override', () => {
  process.env.BENCH_RESULTS_DIR = 'custom-bench-results';
  process.env.ARTIFICER_EXEC_DIR = 'ignored-exec-dir';

  assert.equal(
    benchResultsDir(),
    path.resolve(process.cwd(), 'custom-bench-results'),
  );
});

test('benchResultsDir uses an existing eval latest directory', async (t) => {
  const execDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-exec-'));
  t.onTestFinished(() => fs.rm(execDir, { recursive: true, force: true }));
  const latestDir = path.join(execDir, 'evals', 'latest');
  await fs.mkdir(latestDir, { recursive: true });
  delete process.env.BENCH_RESULTS_DIR;
  process.env.ARTIFICER_EXEC_DIR = execDir;

  assert.equal(benchResultsDir(), latestDir);
});

test('benchResultsDir falls back when the eval latest directory is absent', async (t) => {
  const execDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-exec-'));
  t.onTestFinished(() => fs.rm(execDir, { recursive: true, force: true }));
  delete process.env.BENCH_RESULTS_DIR;
  process.env.ARTIFICER_EXEC_DIR = execDir;

  assert.equal(benchResultsDir(), path.resolve(process.cwd(), 'bench/results'));
});

test('readBenchSuites catalogs suites from the agent identity directory', async (t) => {
  const identityDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-identity-'),
  );
  t.onTestFinished(() => fs.rm(identityDir, { recursive: true, force: true }));
  const suitesDir = path.join(identityDir, 'agent', 'evals', 'suites');
  await fs.mkdir(suitesDir, { recursive: true });
  await fs.writeFile(
    path.join(suitesDir, 'smoke.json'),
    JSON.stringify({
      name: 'Smoke',
      description: 'Fast identity checks',
      taskIds: ['hello-message', 'finish-workstream'],
    }),
  );
  process.env.ARTIFICER_IDENTITY_DIR = identityDir;

  const suites = await readBenchSuites();

  assert.equal(suites.length, 1);
  assert.equal(suites[0]?.id, 'smoke');
  assert.equal(suites[0]?.name, 'Smoke');
  assert.equal(suites[0]?.description, 'Fast identity checks');
  assert.equal(suites[0]?.taskCount, 2);
  assert.equal(suites[0]?.runCommand, 'artificer eval run --suite smoke');
});
