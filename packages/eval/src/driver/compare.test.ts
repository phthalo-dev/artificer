import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  compareEvalRuns,
  formatCompareTable,
  resolveCompareRunDirs,
} from './compare.js';

test('compareEvalRuns diffs resolved ids and cost per solved', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-compare-'));
  const baseline = path.join(root, '2026-08-11T09-00-00Z-smoke');
  const candidate = path.join(root, '2026-08-11T14-32-01Z-smoke');

  try {
    await writeRun(baseline, {
      resolved: ['task-a', 'task-b'],
      unresolved: ['task-c'],
      costs: { 'task-a': 0.1, 'task-b': 0.1, 'task-c': 0.05 },
      costPerSolvedUsd: 0.1,
    });
    await writeRun(candidate, {
      resolved: ['task-a', 'task-c', 'task-d'],
      unresolved: ['task-b'],
      costs: { 'task-a': 0.08, 'task-b': 0.04, 'task-c': 0.04, 'task-d': 0.02 },
      costPerSolvedUsd: 0.06,
    });

    const result = await compareEvalRuns(baseline, candidate, {
      writeSidecar: true,
    });

    assert.equal(result.baselineRunId, '2026-08-11T09-00-00Z-smoke');
    assert.equal(result.candidateRunId, '2026-08-11T14-32-01Z-smoke');
    assert.equal(result.summary.resolvedDelta, 1);
    assert.ok(
      Math.abs((result.summary.costPerSolvedDeltaUsd ?? 0) - -0.04) < 1e-9,
    );
    assert.deepEqual(result.summary.regressions, ['task-b']);
    assert.deepEqual(result.summary.improvements, ['task-c', 'task-d']);

    const sidecar = JSON.parse(
      await fs.readFile(path.join(candidate, 'compare.json'), 'utf8'),
    );
    assert.equal(sidecar.summary.resolvedDelta, 1);

    const table = formatCompareTable(result);
    assert.match(table, /Resolved Δ/);
    assert.match(table, /task-b/);
    assert.match(table, /task-c, task-d/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveCompareRunDirs picks the latest two runs when args omitted', async () => {
  const execDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'eval-compare-exec-'),
  );
  const runs = path.join(execDir, 'evals', 'runs');
  await fs.mkdir(runs, { recursive: true });
  const older = path.join(runs, '2026-08-11T09-00-00Z-smoke');
  const newer = path.join(runs, '2026-08-11T14-32-01Z-smoke');
  await fs.mkdir(older);
  await fs.mkdir(newer);

  try {
    const resolved = await resolveCompareRunDirs(execDir);
    assert.equal(resolved.baselineDir, older);
    assert.equal(resolved.candidateDir, newer);
  } finally {
    await fs.rm(execDir, { recursive: true, force: true });
  }
});

async function writeRun(
  dir: string,
  data: {
    resolved: string[];
    unresolved: string[];
    costs: Record<string, number>;
    costPerSolvedUsd: number;
  },
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const ids = [...data.resolved, ...data.unresolved];
  await fs.writeFile(
    path.join(dir, 'eval-report.json'),
    JSON.stringify({
      schema_version: 1,
      resolved_ids: data.resolved,
      unresolved_ids: data.unresolved,
    }),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'attempts.json'),
    JSON.stringify(
      ids.map((instanceId) => ({
        instanceId,
        usage: { costUsd: data.costs[instanceId] ?? 0 },
      })),
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'report.json'),
    JSON.stringify({
      summary: {
        resolved: data.resolved.length,
        costPerSolvedUsd: data.costPerSolvedUsd,
      },
    }),
    'utf8',
  );
}
