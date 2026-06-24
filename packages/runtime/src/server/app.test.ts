import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import { emptyGithubWatchState, type GithubWatchState } from '../engine/github-watch.js';
import { Store } from '../storage/store.js';
import { createApp } from './app.js';

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
  return { engine, store };
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
