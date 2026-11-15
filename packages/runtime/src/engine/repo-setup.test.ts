import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { findGitRepo } from './git-repo.js';
import { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';

/** Mirrors engine.ts setup-aware unproductive planner detection. */
async function plannerUnproductiveWithoutPlan(
  run: RunRecord,
  store: Store,
): Promise<boolean> {
  const hasWritePlan = run.toolCalls.some(
    (t) => t.name === 'write_plan' && !t.error,
  );
  if (hasWritePlan) return false;
  if (!run.workstreamId) return true;

  const ws = await store.getWorkstream(run.workstreamId);
  if (!ws?.repoUrl) return true;

  const workspaceDir = store.layout.workstreamWorkspace(run.workstreamId);
  const localRepo = await findGitRepo(workspaceDir);
  if (!localRepo) return false;
  return true;
}

function plannerRun(workstreamId: string): RunRecord {
  return {
    id: 'run_planner',
    role: 'planner',
    task: 'clone and plan',
    workstreamId,
    status: 'done',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 1,
    },
    createdAt: new Date().toISOString(),
  };
}

test('planner without write_plan is not unproductive when repo not cloned yet', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-setup-test-'),
  );
  const store = new Store(dataDir);
  await store.init();

  const ws = await store.createWorkstream({
    title: 'repo task',
    goal: 'fix bug',
    repoUrl: 'https://github.com/org/repo.git',
  });

  const unproductive = await plannerUnproductiveWithoutPlan(
    plannerRun(ws.id),
    store,
  );
  assert.equal(unproductive, false);
});

test('planner without write_plan is unproductive when repo exists', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-setup-test-'),
  );
  const store = new Store(dataDir);
  await store.init();

  const ws = await store.createWorkstream({
    title: 'repo task',
    goal: 'fix bug',
    repoUrl: 'https://github.com/org/repo.git',
  });

  const workspaceDir = store.layout.workstreamWorkspace(ws.id);
  await fs.mkdir(path.join(workspaceDir, 'repo', '.git'), { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, 'repo', '.git', 'HEAD'),
    'ref: refs/heads/main\n',
  );

  const unproductive = await plannerUnproductiveWithoutPlan(
    plannerRun(ws.id),
    store,
  );
  assert.equal(unproductive, true);
});
