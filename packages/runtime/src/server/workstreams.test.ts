import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import { Store } from '../storage/store.js';
import { createApp } from './app.js';

const exec = promisify(execFile);

async function bareOrigin(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-origin-'));
  const seed = path.join(root, 'seed');
  const origin = path.join(root, 'origin.git');
  await fs.mkdir(seed);
  await exec('git', ['-C', seed, 'init', '-q', '-b', 'main']);
  await exec('git', ['-C', seed, 'config', 'user.email', 't@t.test']);
  await exec('git', ['-C', seed, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(seed, 'a.txt'), 'one\n');
  await exec('git', ['-C', seed, 'add', '-A']);
  await exec('git', ['-C', seed, 'commit', '-q', '-m', 'init']);
  await exec('git', ['clone', '--bare', seed, origin]);
  return origin;
}

async function buildApp() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-ws-api-'));
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  const engine = new Engine(config, store);
  return { app: createApp(engine), store, config };
}

test('POST /workstreams with autostart=false creates a held workstream and no runs', async () => {
  const { app, store } = await buildApp();

  const res = await app.request('/api/workstreams', {
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
  const body = (await res.json()) as {
    workstreamId: string;
    messageId: string;
  };
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
  const res = await app.request('/api/workstreams/ws_does_not_exist/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messageId: 'msg_x' }),
  });
  assert.equal(res.status, 404);
});

test('POST /workstreams rejects a request missing title/goal', async () => {
  const { app } = await buildApp();
  const res = await app.request('/api/workstreams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'no title' }),
  });
  assert.equal(res.status, 400);
});

test('POST /workstreams conversation rejects an unknown repo and writes nothing', async () => {
  const { app, store } = await buildApp();
  const res = await app.request('/api/workstreams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      driver: 'conversation',
      title: 'Chat',
      goal: 'Look around',
      repoId: 'missing',
    }),
  });
  assert.equal(res.status, 400);
  assert.equal((await store.listWorkstreams()).length, 0);
});

test('POST /workstreams conversation creates a worktree and returns 201', async () => {
  const origin = await bareOrigin();
  const { app, store, config } = await buildApp();
  const repoUrl = 'https://github.com/acme/app';
  config.repos = [{ id: 'app', url: repoUrl, baseBranch: 'main' }];
  const keys = [
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
  ] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = `url.${origin}/.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = repoUrl;
  try {
    const res = await app.request('/api/workstreams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driver: 'conversation',
        title: 'Chat',
        goal: 'Look around',
        repoId: 'app',
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      workstream: { id: string; status: string; repoUrl: string };
    };
    assert.equal(body.workstream.status, 'in_progress');
    assert.equal(body.workstream.repoUrl, repoUrl);
    const gitFile = path.join(
      store.layout.workstreamWorkspace(body.workstream.id),
      'repo',
      '.git',
    );
    assert.equal((await fs.stat(gitFile)).isFile(), true);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('POST /workstreams/:id/worktree/remove rejects active work and preserves the shared checkout', async () => {
  const origin = await bareOrigin();
  const { app, store, config } = await buildApp();
  const repoUrl = 'https://github.com/acme/app';
  config.repos = [{ id: 'app', url: repoUrl, baseBranch: 'main' }];
  const keys = [
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
  ] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = `url.${origin}/.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = repoUrl;
  try {
    const createRes = await app.request('/api/workstreams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driver: 'conversation',
        title: 'Chat',
        goal: 'Look around',
        repoId: 'app',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as {
      workstream: { id: string };
    };
    const id = created.workstream.id;

    const activeRes = await app.request(
      `/api/workstreams/${id}/worktree/remove`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    assert.equal(activeRes.status, 409);
    assert.match(await activeRes.text(), /in_progress/);

    await store.updateWorkstream(id, { status: 'done' });
    const removeRes = await app.request(
      `/api/workstreams/${id}/worktree/remove`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    assert.equal(removeRes.status, 200);
    assert.deepEqual(await removeRes.json(), { ok: true });
    await assert.rejects(
      fs.access(path.join(store.layout.workstreamWorkspace(id), 'repo')),
    );
    await fs.access(path.join(config.execDir, 'repos', 'app'));
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a second message while a worker run is queued returns 409', async () => {
  const origin = await bareOrigin();
  const { app, store, config } = await buildApp();
  const repoUrl = 'https://github.com/acme/app';
  config.repos = [{ id: 'app', url: repoUrl, baseBranch: 'main' }];
  const keys = [
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
  ] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = `url.${origin}/.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = repoUrl;
  try {
    const createRes = await app.request('/api/workstreams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driver: 'conversation',
        title: 'Chat',
        goal: 'Look around',
        repoId: 'app',
      }),
    });
    const created = (await createRes.json()) as {
      workstream: { id: string };
    };
    await store.createRun({
      role: 'worker',
      task: 'busy',
      workstreamId: created.workstream.id,
    });
    const res = await app.request(
      `/api/workstreams/${created.workstream.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'hello' }),
      },
    );
    assert.equal(res.status, 409);
    assert.match(await res.text(), /still working/i);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GET /repos returns 400 when two entries normalize to the same URL', async () => {
  const { app, config } = await buildApp();
  config.repos = [
    { id: 'app', url: 'https://github.com/a/b.git', baseBranch: 'main' },
    { id: 'app2', url: 'git@github.com:a/b.git', baseBranch: 'main' },
  ];
  const res = await app.request('/api/repos');
  assert.equal(res.status, 400);
});

test('POST /workstreams conversation deletes the record when worktree add fails', async () => {
  const { app, store, config } = await buildApp();
  config.repos = [
    {
      id: 'app',
      url: 'https://github.com/acme/missing',
      baseBranch: 'main',
    },
  ];
  const res = await app.request('/api/workstreams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      driver: 'conversation',
      title: 'Chat',
      goal: 'Look around',
      repoId: 'app',
    }),
  });
  assert.equal(res.status, 500);
  assert.equal((await store.listWorkstreams()).length, 0);
});

test('GET /workstreams/:id includes retry-counter progress with caps', async () => {
  const { app, store } = await buildApp();

  const res = await app.request('/api/workstreams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'progress test',
      goal: 'Do a thing',
      autostart: false,
    }),
  });
  const { workstreamId } = (await res.json()) as { workstreamId: string };

  await store.createReview({
    workstreamId,
    target: 'work',
    stage: 'work',
    approved: false,
    notes: 'not quite',
  });

  const detailRes = await app.request(`/api/workstreams/${workstreamId}`);
  assert.equal(detailRes.status, 200);
  const body = (await detailRes.json()) as {
    progress: {
      reviewCycles: { count: number; max: number };
      workerRunsSinceReview: { count: number; max: number };
      noProgressRepeats: { count: number; max: number };
      consecutiveFailedRuns: { count: number; max: number };
      plannerAttempts: { count: number; max: number };
      totalRuns: { count: number; max: number };
    };
  };

  assert.equal(body.progress.reviewCycles.count, 1);
  assert.equal(body.progress.reviewCycles.max, 3);
  assert.equal(body.progress.totalRuns.count, 0);
  assert.ok(body.progress.totalRuns.max > 0);
});
