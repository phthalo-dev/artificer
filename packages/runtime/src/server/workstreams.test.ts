import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import { Store } from '../storage/store.js';
import { createApp } from './app.js';

async function buildApp() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-ws-api-'));
  const config = loadConfig({
    ARTIFICER_DATA_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.dataDir);
  await store.init();
  const engine = new Engine(config, store);
  return { app: createApp(engine), store };
}

test('POST /workstreams with autostart=false creates a held workstream and no runs', async () => {
  const { app, store } = await buildApp();

  const res = await app.request('/workstreams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'requests bug',
      goal: 'Fix urllib3 exception wrapping in adapters.py',
      repoUrl: 'https://github.com/psf/requests.git',
      baseCommit: '0be38a0c37c59c4b66ce908731da15b401655113',
      autostart: false,
    }),
  });
  assert.equal(res.status, 202);
  const body = (await res.json()) as { workstreamId: string; messageId: string };
  assert.ok(body.workstreamId, 'returns a workstreamId');
  assert.ok(body.messageId, 'returns a messageId for cost attribution');

  // The workstream exists, carries the repo fields, and is pending.
  const ws = await store.getWorkstream(body.workstreamId);
  assert.equal(ws?.status, 'pending');
  assert.equal(ws?.repoUrl, 'https://github.com/psf/requests.git');
  assert.equal(ws?.baseCommit, '0be38a0c37c59c4b66ce908731da15b401655113');

  // No communicator and — crucially — no orchestrator run yet: the agent is
  // held until kickoff, which is what lets the harness preflight-clone first.
  const runs = await store.listRunsForWorkstream(body.workstreamId);
  assert.equal(runs.length, 0, 'orchestrator must not start before kickoff');

  // The inbound message exists so cost/usage still attribute to one origin.
  const messages = await store.listMessages();
  assert.ok(messages.some((m) => m.id === body.messageId));
});

test('POST /workstreams/:id/start rejects an unknown workstream', async () => {
  const { app } = await buildApp();
  const res = await app.request('/workstreams/ws_does_not_exist/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messageId: 'msg_x' }),
  });
  assert.equal(res.status, 404);
});

test('POST /workstreams rejects a request missing title/goal', async () => {
  const { app } = await buildApp();
  const res = await app.request('/workstreams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'no title' }),
  });
  assert.equal(res.status, 400);
});
