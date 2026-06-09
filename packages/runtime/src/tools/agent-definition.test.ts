import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { EngineApi, SpawnCallInput, ToolContext } from '../context.js';
import type { RuntimeConfig } from '../config.js';
import { Store } from '../storage/store.js';
import type {
  PhaseAgentDefinition,
  RunRecord,
  Workstream,
} from '../storage/types.js';
import {
  clearAgentRegistry,
  createAgentDefinitionTools,
  getAgentConfig,
  getAgentConfigForWorkstream,
  setAgentConfig,
} from './agent-definition.js';

const AGENT_NAME = 'TestAgent';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run_1',
    role: 'orchestrator',
    task: 'phase plan',
    workstreamId: 'ws_1',
    originMessageId: 'msg_1',
    status: 'running',
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 0,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface FakeEngine {
  engine: EngineApi;
  spawnCalls: SpawnCallInput[];
  emits: unknown[];
  replies: Array<{ content: string; workstreamId?: string }>;
}

function makeFakeEngine(
  store: Store,
  run: RunRecord,
  workstreamId = 'ws_1',
): FakeEngine {
  const spawnCalls: SpawnCallInput[] = [];
  const emits: unknown[] = [];
  const replies: Array<{ content: string; workstreamId?: string }> = [];
  const engine: EngineApi = {
    store,
    config: { agentName: AGENT_NAME } as RuntimeConfig,
    spawnCall: async (input) => {
      spawnCalls.push(input);
      return { runId: `run_${spawnCalls.length}`, taskId: `task_${spawnCalls.length}` };
    },
    startWorkstream: async () => ({}) as Workstream,
    reply: async (content, wsId) => {
      replies.push({ content, workstreamId: wsId });
    },
    emit: (event) => {
      emits.push(event);
    },
  };
  return {
    engine,
    spawnCalls,
    emits,
    replies,
  };
}

async function makeStore(): Promise<Store> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-agent-'));
  const store = new Store(dir);
  await store.init();
  return store;
}

async function makeWorkstream(store: Store, id = 'ws_1'): Promise<Workstream> {
  const ws = await store.createWorkstream({
    title: 't',
    goal: 'g',
    currentPhase: 'implementing',
  });
  assert.ok(ws, 'workstream creation should not return null');
  // Re-stamp with the id we want so the rest of the test can refer to it.
  if (ws.id === id) return ws;
  const updated = await store.updateWorkstream(ws.id, {});
  assert.ok(updated, 'workstream update should not return null');
  return updated;
}

function findTool(name: string, tools: ReturnType<typeof createAgentDefinitionTools>) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

test('define_agent returns a registry id for a valid archetype', async () => {
  clearAgentRegistry();
  const store = await makeStore();
  const fake = makeFakeEngine(store, makeRun());
  const tools = createAgentDefinitionTools({
    engine: fake.engine,
    run: makeRun(),
    workspaceDir: '/tmp',
  });
  const define = findTool('define_agent', tools);

  const out = (await define.handler({ name: 'my-coder', archetype: 'coder' })) as string;
  assert.match(out, /Defined agent "my-coder" with ID agent_/);

  // Pull the id out and look it up in the registry.
  const m = out.match(/ID (agent_\w+)/);
  assert.ok(m);
  const cfg = getAgentConfig(m[1]);
  assert.ok(cfg);
  assert.equal(cfg.name, 'my-coder');
  assert.equal(cfg.archetype, 'coder');
  assert.equal(cfg.modelTier, 'medium');
});

test('define_agent rejects unknown archetype with a readable error', async () => {
  clearAgentRegistry();
  const store = await makeStore();
  const fake = makeFakeEngine(store, makeRun());
  const tools = createAgentDefinitionTools({
    engine: fake.engine,
    run: makeRun(),
    workspaceDir: '/tmp',
  });
  const define = findTool('define_agent', tools);
  const out = await define.handler({ name: 'x', archetype: 'nope' });
  assert.match(String(out), /archetype must be one of/);
});

test('plan_agents rejects unknown agent ids and writes through to the workstream on success', async () => {
  clearAgentRegistry();
  const store = await makeStore();
  const ws = await makeWorkstream(store);
  const run = makeRun({ workstreamId: ws.id });
  const fake = makeFakeEngine(store, run, ws.id);
  const tools = createAgentDefinitionTools({
    engine: fake.engine,
    run,
    workspaceDir: '/tmp',
  });
  const define = findTool('define_agent', tools);
  const plan = findTool('plan_agents', tools);

  const defined = (await define.handler({ name: 'coder-a', archetype: 'coder' })) as string;
  const m1 = defined.match(/ID (agent_\w+)/);
  assert.ok(m1);
  const coderId = m1[1];

  const defined2 = (await define.handler({ name: 'reviewer-a', archetype: 'reviewer' })) as string;
  const m2 = defined2.match(/ID (agent_\w+)/);
  assert.ok(m2);
  const reviewerId = m2[1];

  // Unknown id should error before touching the store.
  const failOut = await plan.handler({
    agents: [{ role: 'worker', agentId: 'agent_does_not_exist' }],
  });
  assert.match(String(failOut), /agent agent_does_not_exist not found/);

  // Valid call should produce agentDefinitions on the workstream.
  const okOut = await plan.handler({
    agents: [
      { role: 'worker', agentId: coderId },
      { role: 'reviewer', agentId: reviewerId },
    ],
  });
  assert.match(String(okOut), new RegExp(`worker=${coderId}.*reviewer=${reviewerId}`));

  const updated = await store.getWorkstream(ws.id);
  assert.ok(updated?.phaseConfig);
  assert.equal(updated.phaseConfig.agentsPlanned, true);
  const defs = updated.phaseConfig.agentDefinitions ?? [];
  const byRole = new Map<string, PhaseAgentDefinition>(
    defs.map((d) => [d.role, d]),
  );
  assert.equal(byRole.get('worker')?.agentConfigId, coderId);
  assert.equal(byRole.get('reviewer')?.agentConfigId, reviewerId);
  assert.ok(updated.phaseConfig.agentConfigs?.[coderId]);
  assert.ok(updated.phaseConfig.agentConfigs?.[reviewerId]);

  clearAgentRegistry();
  const restored = await getAgentConfigForWorkstream(store, ws.id, coderId);
  assert.ok(restored);
  assert.equal(restored.name, 'coder-a');
});

test('plan_agents with no workstream reports an error', async () => {
  clearAgentRegistry();
  const store = await makeStore();
  const fake = makeFakeEngine(store, makeRun({ workstreamId: undefined }));
  const tools = createAgentDefinitionTools({
    engine: fake.engine,
    run: makeRun({ workstreamId: undefined }),
    workspaceDir: '/tmp',
  });
  const define = findTool('define_agent', tools);
  const plan = findTool('plan_agents', tools);

  const out1 = await define.handler({ name: 'x', archetype: 'coder' });
  const m = String(out1).match(/ID (agent_\w+)/);
  assert.ok(m);
  const coderId = m[1];

  const out = await plan.handler({
    agents: [{ role: 'worker', agentId: coderId }],
  });
  assert.match(String(out), /no workstream to configure/);
});

test('spawn_agent spawns a worker run carrying the agent config', async () => {
  clearAgentRegistry();
  const store = await makeStore();
  const ws = await makeWorkstream(store);
  const run = makeRun({ workstreamId: ws.id });
  const fake = makeFakeEngine(store, run, ws.id);
  const tools = createAgentDefinitionTools({
    engine: fake.engine,
    run,
    workspaceDir: '/tmp',
  });
  const define = findTool('define_agent', tools);
  const spawn = findTool('spawn_agent', tools);

  const defined = (await define.handler({ name: 'coder-b', archetype: 'coder' })) as string;
  const m = String(defined).match(/ID (agent_\w+)/);
  assert.ok(m);
  const agentId = m[1];

  const out = await spawn.handler({ agentId, task: 'fix the thing' });
  assert.match(String(out), /Spawned agent "coder-b"/);

  assert.equal(fake.spawnCalls.length, 1);
  const call = fake.spawnCalls[0];
  assert.equal(call.role, 'worker');
  assert.equal(call.description, 'fix the thing');
  assert.equal(call.workstreamId, ws.id);
  assert.equal(call.parentRunId, run.id);
  assert.ok(call.agentConfig);
  assert.equal(call.agentConfig.id, agentId);
  assert.equal(call.agentConfig.archetype, 'coder');
});

test('spawn_agent errors when the agent id is unknown', async () => {
  clearAgentRegistry();
  const store = await makeStore();
  const ws = await makeWorkstream(store);
  const run = makeRun({ workstreamId: ws.id });
  const fake = makeFakeEngine(store, run, ws.id);
  const tools = createAgentDefinitionTools({
    engine: fake.engine,
    run,
    workspaceDir: '/tmp',
  });
  const spawn = findTool('spawn_agent', tools);
  const out = await spawn.handler({ agentId: 'agent_nope', task: 'x' });
  assert.match(String(out), /agent agent_nope not found/);
  assert.equal(fake.spawnCalls.length, 0);
});

test('clearAgentRegistry empties the registry', () => {
  setAgentConfig('agent_temp', {
    id: 'agent_temp',
    name: 'temp',
    archetype: 'coder',
    modelTier: 'medium',
  });
  assert.ok(getAgentConfig('agent_temp'));
  clearAgentRegistry();
  assert.equal(getAgentConfig('agent_temp'), undefined);
});
