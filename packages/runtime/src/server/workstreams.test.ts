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
  return { app: createApp(engine), store, config, engine };
}

async function conversationFixture() {
  const origin = await bareOrigin();
  const fixture = await buildApp();
  const repoUrl = 'https://github.com/acme/app';
  fixture.config.repos = [{ id: 'app', url: repoUrl, baseBranch: 'main' }];
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
  return {
    ...fixture,
    origin,
    restore() {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

async function createChat(app: ReturnType<typeof createApp>): Promise<string> {
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
  const body = (await res.json()) as { workstream: { id: string } };
  return body.workstream.id;
}

test('mark done posts one message and leaves the worktree', async () => {
  const { app, store, restore } = await conversationFixture();
  try {
    const id = await createChat(app);
    const repo = path.join(store.layout.workstreamWorkspace(id), 'repo');
    const res = await app.request(`/api/workstreams/${id}/done`, {
      method: 'POST',
    });
    assert.equal(res.status, 200);
    const ws = await store.getWorkstream(id);
    assert.equal(ws?.status, 'done');
    const messages = (await store.listMessages()).filter(
      (message) => message.workstreamId === id,
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'Marked done.');
    assert.equal((await fs.stat(path.join(repo, '.git'))).isFile(), true);
  } finally {
    restore();
  }
});

test('POST /done rejects a machine workstream', async () => {
  const { app } = await buildApp();
  const createRes = await app.request('/api/workstreams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Machine',
      goal: 'Work',
      autostart: false,
    }),
  });
  const { workstreamId } = (await createRes.json()) as {
    workstreamId: string;
  };
  const res = await app.request(`/api/workstreams/${workstreamId}/done`, {
    method: 'POST',
  });
  assert.equal(res.status, 409);
});

test('POST /done rejects a conversation with a running worker', async () => {
  const { app, store, restore } = await conversationFixture();
  try {
    const id = await createChat(app);
    await store.createRun({
      role: 'worker',
      task: 'busy',
      workstreamId: id,
      status: 'running',
    });
    const res = await app.request(`/api/workstreams/${id}/done`, {
      method: 'POST',
    });
    assert.equal(res.status, 409);
    assert.equal((await store.getWorkstream(id))?.status, 'in_progress');
  } finally {
    restore();
  }
});

test('a conversation stores the instance executor and an explicit base commit', async () => {
  const { app, store, config, origin, restore } = await conversationFixture();
  try {
    config.executor = 'claude-code';
    const seed = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-base-'));
    await exec('git', ['clone', '-q', origin, seed]);
    await exec('git', ['-C', seed, 'config', 'user.email', 't@t.test']);
    await exec('git', ['-C', seed, 'config', 'user.name', 'Test']);
    const baseCommit = (
      await exec('git', ['-C', seed, 'rev-parse', 'HEAD'])
    ).stdout.trim();
    await fs.writeFile(path.join(seed, 'b.txt'), 'two\n');
    await exec('git', ['-C', seed, 'add', '-A']);
    await exec('git', ['-C', seed, 'commit', '-q', '-m', 'second']);
    await exec('git', ['-C', seed, 'push', '-q', 'origin', 'HEAD:main']);

    const created = await app.request('/api/workstreams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driver: 'conversation',
        title: 'Chat',
        goal: 'Look around',
        repoId: 'app',
        baseCommit,
      }),
    });
    assert.equal(created.status, 201);
    const body = (await created.json()) as { workstream: { id: string } };
    const ws = await store.getWorkstream(body.workstream.id);
    assert.equal(ws?.executor, 'claude-code');
    assert.equal(ws?.baseCommit, baseCommit);
    const head = (
      await exec('git', [
        '-C',
        path.join(store.layout.workstreamWorkspace(ws!.id), 'repo'),
        'rev-parse',
        'HEAD',
      ])
    ).stdout.trim();
    assert.equal(head, baseCommit);

    const builtin = await app.request('/api/workstreams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driver: 'conversation',
        title: 'Loop',
        goal: 'Use the built-in loop',
        repoId: 'app',
        executor: 'llm',
      }),
    });
    assert.equal(builtin.status, 201);
    const builtinBody = (await builtin.json()) as {
      workstream: { id: string };
    };
    assert.equal(
      (await store.getWorkstream(builtinBody.workstream.id))?.executor,
      'llm',
    );

    const rejected = await app.request('/api/workstreams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driver: 'conversation',
        title: 'Nope',
        goal: 'Reject machine fields',
        repoId: 'app',
        autostart: false,
      }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    restore();
  }
});

test('conversation create accepts, persists, and validates acp executors', async () => {
  const { app, store, restore } = await conversationFixture();
  try {
    const post = (executor: unknown) =>
      app.request('/api/workstreams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          driver: 'conversation',
          title: 'Acp',
          goal: 'Talk to an acp agent',
          repoId: 'app',
          executor,
        }),
      });

    const ok = await post({ type: 'acp', command: 'gemini', args: ['--acp'] });
    assert.equal(ok.status, 201);
    const body = (await ok.json()) as { workstream: { id: string } };
    assert.deepEqual(
      (await store.getWorkstream(body.workstream.id))?.executor,
      {
        type: 'acp',
        command: 'gemini',
        args: ['--acp'],
      },
    );

    assert.equal((await post({ type: 'acp', command: 'gemini' })).status, 400);
    assert.equal(
      (await post({ type: 'acp', command: 'x', args: [], agent: 'codex' }))
        .status,
      400,
    );
  } finally {
    restore();
  }
});

test('stop posts no conversation reply', async () => {
  const { app, store, engine, restore } = await conversationFixture();
  try {
    const created = await app.request('/api/workstreams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driver: 'conversation',
        title: 'Chat',
        goal: 'Look around',
        repoId: 'app',
        executor: {
          type: 'cli',
          command: 'sh',
          args: ['-c', 'sleep 30'],
          promptMode: 'stdin',
          timeout: 2000,
        },
      }),
    });
    assert.equal(created.status, 201);
    const id = ((await created.json()) as { workstream: { id: string } })
      .workstream.id;
    const posted = await app.request(`/api/workstreams/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });
    assert.equal(posted.status, 202);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const runs = await store.listRunsForWorkstream(id);
      if (runs.some((run) => run.status === 'running')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const cancelled = await app.request(`/api/workstreams/${id}/cancel`, {
      method: 'POST',
    });
    assert.equal(cancelled.status, 200);
    await waitForIdle(engine, store, id);
    const messages = (await store.listMessages()).filter(
      (message) => message.workstreamId === id,
    );
    assert.deepEqual(
      messages.map((message) => message.direction),
      ['inbound'],
    );
  } finally {
    restore();
  }
});

test('cancel marks a conversation cancelled without a cancelled error bubble', async () => {
  const { app, store, restore } = await conversationFixture();
  try {
    const id = await createChat(app);
    const res = await app.request(`/api/workstreams/${id}/cancel`, {
      method: 'POST',
    });
    assert.equal(res.status, 200);
    assert.equal((await store.getWorkstream(id))?.status, 'cancelled');
    const messages = (await store.listMessages()).filter(
      (message) => message.workstreamId === id,
    );
    assert.equal(messages.length, 0);
  } finally {
    restore();
  }
});

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

test('GET /workstreams/:id includes the resolved executor', async () => {
  const { app, store, config } = await buildApp();
  const builtIn = await store.createWorkstream({
    title: 'Built-in executor',
    goal: 'Show the built-in executor',
  });
  const builtInBody = (await (
    await app.request(`/api/workstreams/${builtIn.id}`)
  ).json()) as { resolvedExecutor?: string | null };
  assert.equal(builtInBody.resolvedExecutor, null);

  config.executor = 'claude-code';
  const inherited = await store.createWorkstream({
    title: 'Inherited executor',
    goal: 'Show the configured executor',
  });
  const overridden = await store.createWorkstream({
    title: 'Override executor',
    goal: 'Show the workstream executor',
    executor: 'cursor-agent',
  });

  const inheritedBody = (await (
    await app.request(`/api/workstreams/${inherited.id}`)
  ).json()) as { resolvedExecutor?: string };
  const overriddenBody = (await (
    await app.request(`/api/workstreams/${overridden.id}`)
  ).json()) as { resolvedExecutor?: string };

  assert.equal(inheritedBody.resolvedExecutor, 'claude-code');
  assert.equal(overriddenBody.resolvedExecutor, 'cursor-agent');
});

async function waitForIdle(engine: Engine, store: Store, id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = await engine.getState();
    const runs = await store.listRunsForWorkstream(id);
    const busyRun = runs.some(
      (run) => run.status === 'queued' || run.status === 'running',
    );
    if (attempt >= 5 && !state.busy && !busyRun) return;
  }
  assert.fail('scheduler did not go idle');
}

test('mark done leaves exactly one message once the scheduler is idle', async () => {
  const { app, store, engine, restore } = await conversationFixture();
  try {
    const id = await createChat(app);
    const res = await app.request(`/api/workstreams/${id}/done`, {
      method: 'POST',
    });
    assert.equal(res.status, 200);
    await waitForIdle(engine, store, id);
    const messages = (await store.listMessages()).filter(
      (message) => message.workstreamId === id,
    );
    assert.deepEqual(
      messages.map((message) => message.content),
      ['Marked done.'],
    );
    const runs = await store.listRunsForWorkstream(id);
    assert.equal(
      runs.some((run) => run.role === 'receipt'),
      false,
    );
  } finally {
    restore();
  }
});

test('a queued conversation turn after mark done fails cancelled and posts nothing', async () => {
  const { app, store, engine, restore } = await conversationFixture();
  try {
    const id = await createChat(app);
    const run = await store.createRun({
      role: 'worker',
      task: 'late turn',
      workstreamId: id,
    });
    await store.updateWorkstream(id, { status: 'done' });
    await (
      engine as unknown as { runOne(runId: string): Promise<void> }
    ).runOne(run.id);
    const saved = await store.getRun(run.id);
    assert.equal(saved?.status, 'failed');
    assert.equal(saved?.error, 'cancelled');
    const messages = (await store.listMessages()).filter(
      (message) => message.workstreamId === id,
    );
    assert.equal(messages.length, 0);
  } finally {
    restore();
  }
});

test('a done machine workstream with its own clone can be removed', async () => {
  const origin = await bareOrigin();
  const { app, store, config } = await buildApp();
  config.repos = [
    { id: 'other', url: 'https://github.com/acme/other', baseBranch: 'main' },
  ];
  const reposDir = path.join(config.execDir, 'repos');
  await fs.mkdir(path.join(reposDir, 'other'), { recursive: true });
  await fs.writeFile(path.join(reposDir, 'other', 'keep.txt'), 'keep\n');
  const ws = await store.createWorkstream({
    title: 'Machine',
    goal: 'Work',
    repoUrl: origin,
    status: 'done',
  });
  const workspaceDir = store.layout.workstreamWorkspace(ws.id);
  await fs.mkdir(workspaceDir, { recursive: true });
  await exec('git', ['clone', '-q', origin, path.join(workspaceDir, 'repo')]);

  const res = await app.request(`/api/workstreams/${ws.id}/worktree/remove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200);
  await assert.rejects(fs.access(path.join(workspaceDir, 'repo')));
  assert.deepEqual(await fs.readdir(reposDir), ['other']);
  assert.equal(
    await fs.readFile(path.join(reposDir, 'other', 'keep.txt'), 'utf8'),
    'keep\n',
  );
});

test('conversation chat stays out of the inbox and channel fallback', async () => {
  const { app, store, engine, restore } = await conversationFixture();
  try {
    await store.appendMessage({
      direction: 'inbound',
      content: 'from slack',
      channelContext: { name: 'slack', metadata: { channel: 'C1' } },
    });
    const id = await createChat(app);
    await store.appendMessage({
      direction: 'inbound',
      content: 'chat question',
      workstreamId: id,
    });
    await store.appendMessage({
      direction: 'outbound',
      content: 'chat answer',
      workstreamId: id,
    });
    const machine = await store.createWorkstream({
      title: 'Machine',
      goal: 'Work',
      status: 'done',
    });
    await store.appendMessage({
      direction: 'outbound',
      content: 'machine receipt',
      workstreamId: machine.id,
    });

    const res = await app.request('/api/messages');
    const body = (await res.json()) as { messages: Array<{ content: string }> };
    assert.deepEqual(
      body.messages.map((message) => message.content),
      ['from slack', 'machine receipt'],
    );
    const resolve = (
      engine as unknown as {
        resolveChannelContext(id?: string): Promise<unknown>;
      }
    ).resolveChannelContext.bind(engine);
    assert.equal(await resolve(id), undefined);
    assert.deepEqual(await resolve(machine.id), {
      name: 'slack',
      metadata: { channel: 'C1' },
    });
  } finally {
    restore();
  }
});
