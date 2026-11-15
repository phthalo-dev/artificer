import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { loadConfig } from '../config.js';
import type { IdentityRole } from '../discover/loader.js';
import { Store } from '../storage/store.js';
import type { ToolInvocation } from '../storage/types.js';
import { executeCall } from './call.js';
import { Engine } from './engine.js';
import type { WorkerExecutor } from './executor.js';
import { RoleRegistry } from './role-registry.js';

test('worker run passes policy, onToolCall and emit to the executor', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-call-executor-'),
  );
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  const run = await store.createRun({
    role: 'worker',
    task: 'do it',
    model: 'test-model',
    status: 'queued',
  });

  let seen: Parameters<WorkerExecutor['execute']>[0] | undefined;
  const executor: WorkerExecutor = {
    name: 'stub',
    async execute(opts) {
      seen = opts;
      return { text: 'done' };
    },
  };
  const engine = new Engine(config, store);

  await executeCall(run, {
    resolveModel: () => {
      throw new Error('no model expected');
    },
    config,
    store,
    engine,
    executor,
    registry: new RoleRegistry(),
  });

  assert.ok(seen, 'executor was called');
  assert.ok(seen.policy, 'policy defined');
  assert.equal(typeof seen.onToolCall, 'function');
  assert.equal(typeof seen.emit, 'function');
  const invocation: ToolInvocation = {
    name: 'acp:read',
    input: {},
    output: 'ok',
    at: new Date().toISOString(),
  };
  const before = run.toolCalls.length;
  seen.onToolCall!(invocation);
  assert.equal(run.toolCalls.length, before + 1);
  assert.equal(run.toolCalls[before], invocation);
});

test('custom role passes its base role to the executor', async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-call-executor-'),
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
  const run = await store.createRun({
    role: 'security-auditor',
    task: 'review it',
    model: 'test-model',
    status: 'queued',
  });

  let seen: Parameters<WorkerExecutor['execute']>[0] | undefined;
  const executor: WorkerExecutor = {
    name: 'stub',
    async execute(opts) {
      seen = opts;
      return { text: 'done' };
    },
  };
  const engine = new Engine(config, store, undefined, registry);

  await executeCall(run, {
    resolveModel: () => {
      throw new Error('no model expected');
    },
    config,
    store,
    engine,
    executor,
    registry,
  });

  assert.ok(seen, 'executor was called');
  assert.equal(seen.run.role, 'security-auditor');
  assert.equal(seen.role, 'reviewer');
});
