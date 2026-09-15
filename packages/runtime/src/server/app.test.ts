import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import {
  emptyGithubWatchState,
  type GithubWatchState,
} from '../engine/github-watch.js';
import { WorkstreamMemoryService } from '../engine/workstream-memory.js';
import { Store } from '../storage/store.js';
import { IdentityStore } from '../storage/identity-store.js';
import { createApp } from './app.js';
import type { Memory } from '../storage/types.js';
import { saveExecPolicy, type PolicyRule } from '../tools/tool-policy.js';

async function buildApp(env: NodeJS.ProcessEnv = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-app-'));
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
    ...env,
  });
  const store = new Store(config.execDir);
  await store.init();
  const engine = new Engine(config, store);
  return { engine, store, dataDir };
}

async function buildAppWithIdentity(env: NodeJS.ProcessEnv = {}) {
  const { engine, store, dataDir } = await buildApp(env);
  const identity = new IdentityStore(dataDir);
  await identity.init();
  return { engine, store, identity, dataDir };
}

async function buildEngineWithMemory(env: NodeJS.ProcessEnv = {}) {
  const { store, dataDir } = await buildApp(env);
  const identity = new IdentityStore(dataDir);
  await identity.init();
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
    ...env,
  });
  const memoryService = new WorkstreamMemoryService(identity, store);
  const engine = new Engine(config, store, memoryService);
  return { engine, store, identity, dataDir };
}

test('POST /api/github/watch returns 400 when GitHub is not configured', async () => {
  const { engine } = await buildApp();
  const app = createApp(engine);

  const res = await app.request('/api/github/watch', { method: 'POST' });
  assert.equal(res.status, 400);
});

test('POST /api/github/watch runs one cycle and returns the resulting state', async () => {
  const { engine } = await buildApp({ GITHUB_TOKEN: 'gh-token' });

  const updated: GithubWatchState = {
    ...emptyGithubWatchState(),
    notificationsSince: '2024-01-01T00:00:00.000Z',
  };
  let called = 0;
  const app = createApp(engine, {
    runGithubWatchOnce: async () => {
      called += 1;
      return updated;
    },
  });

  const res = await app.request('/api/github/watch', { method: 'POST' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { state: GithubWatchState };
  assert.deepEqual(body.state, updated);
  assert.equal(called, 1);
});

test('GET /api/health returns agent name', async () => {
  const { engine } = await buildApp();
  const app = createApp(engine);

  const res = await app.request('/api/health');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; agent: string };
  assert.equal(body.ok, true);
});

test('POST /api/policy/rules persists a rule returned by GET', async () => {
  const { engine } = await buildApp();
  const app = createApp(engine);

  const createRes = await app.request('/api/policy/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tool: 'shell',
      pattern: 'pnpm test*',
      effect: 'allow',
      note: 'Allow runtime tests',
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { rule: PolicyRule };
  assert.equal(created.rule.tool, 'shell');
  assert.equal(created.rule.pattern, 'pnpm test*');
  assert.equal(created.rule.effect, 'allow');
  assert.equal(created.rule.scope, 'agent');
  assert.equal(created.rule.note, 'Allow runtime tests');
  assert.ok(created.rule.id);
  assert.ok(Date.parse(created.rule.createdAt));

  const listRes = await app.request('/api/policy/rules');
  assert.equal(listRes.status, 200);
  const listed = (await listRes.json()) as { rules: PolicyRule[] };
  assert.deepEqual(listed.rules, [created.rule]);
});

test('DELETE /api/policy/rules/:id removes an exec rule', async () => {
  const { engine } = await buildApp();
  const execRule: PolicyRule = {
    id: 'exec-rule',
    tool: 'fetch',
    pattern: 'GET https://example.com/*',
    effect: 'deny',
    scope: 'agent',
    createdAt: '2026-08-25T00:00:00.000Z',
  };
  saveExecPolicy(engine.store.layout.toolPolicyFile(), {
    version: 1,
    rules: [execRule],
  });
  const app = createApp(engine);

  const deleteRes = await app.request(`/api/policy/rules/${execRule.id}`, {
    method: 'DELETE',
  });
  assert.equal(deleteRes.status, 200);

  const listRes = await app.request('/api/policy/rules');
  const listed = (await listRes.json()) as { rules: PolicyRule[] };
  assert.deepEqual(listed.rules, []);
});

test('DELETE /api/policy/rules/:id cannot remove an identity-only rule', async () => {
  const { engine: baseEngine, store, dataDir } = await buildApp();
  const identity = new IdentityStore(dataDir);
  await identity.init();
  const identityRule: PolicyRule = {
    id: 'identity-rule',
    tool: 'shell',
    pattern: 'git status',
    effect: 'allow',
    scope: 'agent',
    createdAt: '2026-08-25T00:00:00.000Z',
  };
  saveExecPolicy(identity.layout.agentToolPolicyFile(), {
    version: 1,
    rules: [identityRule],
  });
  const engine = new Engine(
    baseEngine.config,
    store,
    undefined,
    undefined,
    identity,
  );
  const app = createApp(engine);

  const deleteRes = await app.request(`/api/policy/rules/${identityRule.id}`, {
    method: 'DELETE',
  });
  assert.equal(deleteRes.status, 404);

  const listRes = await app.request('/api/policy/rules');
  const listed = (await listRes.json()) as { rules: PolicyRule[] };
  assert.deepEqual(listed.rules, [identityRule]);
});

test('POST /api/policy/rules rejects an invalid effect', async () => {
  const { engine } = await buildApp();
  const app = createApp(engine);

  const res = await app.request('/api/policy/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tool: 'shell',
      pattern: 'pnpm test*',
      effect: 'prompt',
    }),
  });
  assert.equal(res.status, 400);
});

test('GET /api/memories returns 503 when identity store is not configured', async () => {
  const { engine } = await buildApp();
  const app = createApp(engine);

  const res = await app.request('/api/memories');
  assert.equal(res.status, 503);
});

test('GET /api/memories lists memories from identity store', async () => {
  const { engine, identity } = await buildAppWithIdentity();
  await identity.addMemory({
    content: 'Hello identity',
    tags: [],
    kind: 'note',
  });
  const app = createApp(engine, { identity });

  const res = await app.request('/api/memories');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { memories: Memory[] };
  assert.equal(body.memories.length, 1);
  assert.equal(body.memories[0].content, 'Hello identity');
});

test('GET /api/memories?q= returns packed related neighbors', async () => {
  const { engine, identity } = await buildAppWithIdentity();
  const doc = await identity.addMemory({
    content: 'Chronicle about payments TDD.',
    title: 'Payments chronicle',
    summary: 'Payments TDD chronicle',
    tags: ['payments'],
    kind: 'document',
  });
  const claim = await identity.addMemory({
    content: 'Write failing tests first.',
    title: 'TDD claim',
    summary: 'TDD first',
    tags: ['payments'],
    kind: 'claim',
    related: [{ id: doc.id, type: 'builds_on' }],
  });
  const app = createApp(engine, { identity });

  const res = await app.request(
    `/api/memories?q=${encodeURIComponent('Payments chronicle')}&limit=1`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    memories: Memory[];
    related: Array<{ to: string; type: string; content?: string }>;
    charBudget: { used: number; limit: number };
  };
  assert.equal(body.memories.length, 1);
  assert.equal(body.memories[0]?.id, doc.id);
  assert.ok(body.related.some((r) => r.to === claim.id));
  assert.ok(body.related.some((r) => r.content?.includes('failing tests')));
  assert.ok(body.charBudget.limit > 0);
});

test('POST /api/memories creates a memory in identity store', async () => {
  const { engine, identity } = await buildAppWithIdentity();
  const app = createApp(engine, { identity });

  const res = await app.request('/api/memories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: 'Prefer tabs over spaces',
      title: 'Code style',
      summary: 'Indentation preference',
      tags: ['style', 'code'],
      kind: 'preference',
      source: 'conversation',
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { memory: Memory };
  assert.equal(body.memory.content, 'Prefer tabs over spaces');
  assert.equal(body.memory.title, 'Code style');
  assert.deepEqual(body.memory.tags, ['style', 'code']);

  const all = await identity.listMemories();
  assert.equal(all.length, 1);
});

test('POST /api/memories returns 400 when content is missing', async () => {
  const { engine, identity } = await buildAppWithIdentity();
  const app = createApp(engine, { identity });

  const res = await app.request('/api/memories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'No content here' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/memories/:id removes memory from identity store', async () => {
  const { engine, identity } = await buildAppWithIdentity();
  const memory = await identity.addMemory({
    content: 'To be deleted',
    tags: [],
    kind: 'note',
  });
  const app = createApp(engine, { identity });

  const res = await app.request(`/api/memories/${memory.id}`, {
    method: 'DELETE',
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);

  const all = await identity.listMemories();
  assert.equal(all.length, 0);
});

test('DELETE /api/memories/:id returns 404 for unknown id', async () => {
  const { engine, identity } = await buildAppWithIdentity();
  const app = createApp(engine, { identity });

  const res = await app.request('/api/memories/nonexistent_id', {
    method: 'DELETE',
  });
  assert.equal(res.status, 404);
});

test('Engine exposes service operations end to end', async () => {
  const { engine, store } = await buildApp();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  const repoRoot = store.layout.workstreamWorkspace(ws.id);
  await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, '.artificer'), { recursive: true });
  const script = path.join(repoRoot, 'long-lived.mjs');
  await fs.writeFile(script, 'setInterval(() => {}, 1000);\n');
  await fs.writeFile(
    path.join(repoRoot, '.artificer', 'workspace.json'),
    JSON.stringify({
      services: {
        web: {
          run: `${process.execPath} ${script}`,
          portRange: [41300, 41309],
        },
      },
    }),
  );

  const started = await engine.startService(ws.id, 'web');
  assert.equal(started.status, 'started');
  const listed = await engine.listServices(ws.id);
  assert.equal(listed[0]?.status, 'running');
  const stopped = await engine.stopService(ws.id, 'web');
  assert.equal(stopped.status, 'stopped');
});

test('Engine creates an identity memory when a workstream is started', async () => {
  const { engine, identity } = await buildEngineWithMemory();

  await engine.startWorkstream({
    title: 'Test workstream',
    goal: 'Do something useful',
  });

  // Allow async fire-and-forget to settle
  await new Promise((r) => setTimeout(r, 50));

  const memories = await identity.listMemories();
  assert.ok(memories.length >= 1);
  const ws = memories.find((m) => m.source?.startsWith('workstream:'));
  assert.ok(ws, 'expected a workstream memory');
  assert.equal(ws!.title, 'Test workstream');
  assert.ok(ws!.content.includes('Do something useful'));
});
