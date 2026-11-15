import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { loadConfig } from '../config.js';
import { Store } from '../storage/store.js';
import { emptyUsage, type RunRecord } from '../storage/types.js';
import { Engine } from './engine.js';
import { RoleRegistry } from './role-registry.js';
import type { IdentityRole } from '../discover/loader.js';
import { MAX_FAILED_RUNS } from './workstream-machine.js';

async function buildEngine() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-engine-'));
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  return { engine: new Engine(config, store), store };
}

test('resumeInterruptedWorkstreams advances the FSM instead of spawning an LLM orchestrator', async () => {
  const { engine, store } = await buildEngine();

  const ws = await store.createWorkstream({
    title: 'test workstream',
    goal: 'do the thing',
    status: 'planning',
  });

  // MAX_FAILED_RUNS consecutive failed planner runs -- the last one is the
  // "recovered" zombie run from a crashed runtime.
  const runs = [];
  for (let i = 0; i < MAX_FAILED_RUNS; i += 1) {
    const run = await store.createRun({
      role: 'planner',
      task: 'plan',
      workstreamId: ws.id,
      model: 'test-model',
      status: 'failed',
    });
    runs.push(run);
  }

  const resumed = await engine.resumeInterruptedWorkstreams([
    runs[runs.length - 1],
  ]);
  assert.equal(resumed, 1);

  // The FSM sees MAX_FAILED_RUNS consecutive failures and blocks the
  // workstream directly -- no LLM call needed to reach that decision.
  const updated = await store.getWorkstream(ws.id);
  assert.equal(updated?.status, 'blocked');

  const allRuns = await store.listRunsForWorkstream(ws.id);
  assert.ok(
    !allRuns.some((r) => r.role === 'orchestrator'),
    'should not spawn an orchestrator run',
  );
});

test('Engine.listRoles includes built-ins and custom roles from registry', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-engine-roles-'),
  );
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();

  const customRole: IdentityRole = {
    slug: 'security-auditor',
    name: 'Security Auditor',
    blurb: 'Finds bugs.',
    baseRole: 'reviewer',
    systemTemplate: 'You are {{agentName}} auditor.',
  };
  const registry = new RoleRegistry([customRole]);
  const engine = new Engine(config, store, undefined, registry);

  const roles = engine.listRoles();
  assert.ok(roles.includes('worker'), 'should include built-in worker');
  assert.ok(roles.includes('security-auditor'), 'should include custom role');
});

test('handleInsufficientBalance blocks the workstream and tears down its running services', async () => {
  const { engine, store } = await buildEngine();

  const ws = await store.createWorkstream({ title: 'billing test', goal: 'g' });

  // Simulate a tracked service for this workstream, the way ServiceManager
  // would persist it after start_service. A dead pid is enough to prove
  // teardownWorkstream actually ran: doStop's "already dead" branch prunes
  // the entry from the state file even without a live process to signal.
  const stateFile = store.layout.workstreamServicesStateFile(ws.id);
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(
    stateFile,
    JSON.stringify([
      {
        name: 'web',
        pid: 999_999,
        port: 41500,
        startedAt: new Date().toISOString(),
        script: 'dead',
      },
    ]),
  );

  const run: RunRecord = {
    id: 'run-1',
    role: 'worker',
    task: 'do the thing',
    workstreamId: ws.id,
    status: 'failed',
    toolCalls: [],
    usage: emptyUsage(),
    error: 'insufficient balance',
    createdAt: new Date().toISOString(),
  };

  // afterRun is private, and is the sole caller of handleInsufficientBalance
  // (from runOne, inside the scheduler). Calling it directly here - rather
  // than driving a real run through the scheduler/executor to a failure -
  // avoids mocking the underlying LLM network call that a full end-to-end
  // path would require, while still exercising the exact wiring this fix
  // touches (handleInsufficientBalance -> handleWorkstreamTerminal ->
  // serviceManager.teardownWorkstream).
  await (
    engine as unknown as { afterRun: (run: RunRecord) => Promise<void> }
  ).afterRun(run);

  const updated = await store.getWorkstream(ws.id);
  assert.equal(updated?.status, 'blocked');

  // handleWorkstreamTerminal is invoked fire-and-forget (`void`), matching
  // blockWorkstream's existing pattern - poll briefly for the async
  // teardown to land instead of asserting immediately.
  let rawState: unknown[] = [{ pending: true }];
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    rawState = JSON.parse(await fs.readFile(stateFile, 'utf-8'));
    if (rawState.length === 0) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.deepEqual(
    rawState,
    [],
    'teardownWorkstream should have pruned the tracked service entry - before the fix, handleInsufficientBalance never called handleWorkstreamTerminal, so this entry would still be there',
  );
});
