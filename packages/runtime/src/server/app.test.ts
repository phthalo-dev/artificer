import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import { emptyGithubWatchState, type GithubWatchState } from '../engine/github-watch.js';
import { Store } from '../storage/store.js';
import { IdentityStore } from '../storage/identity-store.js';
import { createApp } from './app.js';
import type { Memory } from '../storage/types.js';

async function buildApp(env: NodeJS.ProcessEnv = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-app-'));
  const config = loadConfig({
    ARTIFICER_DATA_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
    ...env,
  });
  const store = new Store(config.dataDir);
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

test('GET /api/memories returns 503 when identity store is not configured', async () => {
  const { engine } = await buildApp();
  const app = createApp(engine);

  const res = await app.request('/api/memories');
  assert.equal(res.status, 503);
});

test('GET /api/memories lists memories from identity store', async () => {
  const { engine, identity } = await buildAppWithIdentity();
  await identity.addMemory({ content: 'Hello identity', tags: [], kind: 'note' });
  const app = createApp(engine, { identity });

  const res = await app.request('/api/memories');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { memories: Memory[] };
  assert.equal(body.memories.length, 1);
  assert.equal(body.memories[0].content, 'Hello identity');
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
  const memory = await identity.addMemory({ content: 'To be deleted', tags: [], kind: 'note' });
  const app = createApp(engine, { identity });

  const res = await app.request(`/api/memories/${memory.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);

  const all = await identity.listMemories();
  assert.equal(all.length, 0);
});

test('DELETE /api/memories/:id returns 404 for unknown id', async () => {
  const { engine, identity } = await buildAppWithIdentity();
  const app = createApp(engine, { identity });

  const res = await app.request('/api/memories/nonexistent_id', { method: 'DELETE' });
  assert.equal(res.status, 404);
});
