import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { Store } from '../storage/store.js';
import { ServiceManager } from './service-manager.js';

async function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-svc-data-'));
  const config = loadConfig({
    ARTIFICER_EXEC_DIR: dataDir,
    LLM_API_KEY: 'test-key-not-used',
    PORT: '0',
  });
  const store = new Store(config.execDir);
  await store.init();
  const ws = await store.createWorkstream({ title: 't', goal: 'g' });
  const repoRoot = store.layout.workstreamWorkspace(ws.id);
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true }); // makes findGitRepo resolve repoRoot itself
  return { store, config, ws, repoRoot };
}

function writeServiceConfig(repoRoot: string, services: object): void {
  const dir = path.join(repoRoot, '.artificer');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workspace.json'),
    JSON.stringify({ services }),
  );
}

function longLivedScript(dir: string): string {
  const file = path.join(dir, 'long-lived.mjs');
  fs.writeFileSync(file, "setInterval(() => {}, 1000);\n");
  return file;
}

function crashingScript(dir: string): string {
  const file = path.join(dir, 'crash.mjs');
  fs.writeFileSync(file, "process.exit(1);\n");
  return file;
}

test('start spawns the run script and records state', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41100, 41109] },
  });
  const manager = new ServiceManager(store, config);
  const result = await manager.start(ws.id, 'web');
  assert.equal(result.status, 'started');
  if (result.status === 'started') {
    assert.ok(result.port >= 41100 && result.port <= 41109);
    assert.equal(result.url, `http://127.0.0.1:${result.port}`);
    process.kill(
      JSON.parse(
        fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
      )[0].pid,
      'SIGKILL',
    );
  }
});

test('start is idempotent for an already-running service', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41110, 41119] },
  });
  const manager = new ServiceManager(store, config);
  const first = await manager.start(ws.id, 'web');
  const second = await manager.start(ws.id, 'web');
  assert.equal(second.status, 'already_running');
  if (first.status === 'started' && second.status === 'already_running') {
    assert.equal(first.port, second.port);
    process.kill(
      JSON.parse(
        fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
      )[0].pid,
      'SIGKILL',
    );
  }
});

test('start reports failure when the process exits immediately', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = crashingScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41120, 41129] },
  });
  const manager = new ServiceManager(store, config);
  const result = await manager.start(ws.id, 'web');
  assert.equal(result.status, 'error');
});

test('start runs setup once before the first run', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  const marker = path.join(repoRoot, 'setup-ran.txt');
  writeServiceConfig(repoRoot, {
    web: {
      setup: `touch ${marker}`,
      run: `${process.execPath} ${script}`,
      portRange: [41130, 41139],
    },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  assert.ok(fs.existsSync(marker));
  process.kill(
    JSON.parse(
      fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
    )[0].pid,
    'SIGKILL',
  );
});

test('start returns an error for an unknown service name', async () => {
  const { store, config, ws, repoRoot } = await setup();
  writeServiceConfig(repoRoot, {});
  const manager = new ServiceManager(store, config);
  const result = await manager.start(ws.id, 'web');
  assert.equal(result.status, 'error');
});

test('concurrent start calls for the same service do not race', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41140, 41149] },
  });
  const manager = new ServiceManager(store, config);
  const [first, second] = await Promise.all([
    manager.start(ws.id, 'web'),
    manager.start(ws.id, 'web'),
  ]);
  assert.equal(first.status, 'started');
  assert.deepEqual(first, second);

  const states = JSON.parse(
    fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
  );
  const webStates = states.filter((s: { name: string }) => s.name === 'web');
  assert.equal(webStates.length, 1);

  process.kill(webStates[0].pid, 'SIGKILL');
});

test('stop kills the process, runs teardown, and is idempotent', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  const teardownMarker = path.join(repoRoot, 'teardown-ran.txt');
  writeServiceConfig(repoRoot, {
    web: {
      run: `${process.execPath} ${script}`,
      teardown: `touch ${teardownMarker}`,
      portRange: [41200, 41209],
    },
  });
  const manager = new ServiceManager(store, config);
  const started = await manager.start(ws.id, 'web');
  assert.equal(started.status, 'started');

  const stopped = await manager.stop(ws.id, 'web');
  assert.equal(stopped.status, 'stopped');
  assert.ok(fs.existsSync(teardownMarker));

  const stoppedAgain = await manager.stop(ws.id, 'web');
  assert.equal(stoppedAgain.status, 'already_stopped');
});

test('list reports running and stopped services', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41210, 41219] },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  const listed = await manager.list(ws.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'web');
  assert.equal(listed[0].status, 'running');
  await manager.stop(ws.id, 'web');
});

test('check fetches a running service and returns its status/body', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const serverFile = path.join(repoRoot, 'server.mjs');
  fs.writeFileSync(
    serverFile,
    "import http from 'node:http';\n" +
      "http.createServer((_, res) => res.end('ok')).listen(Number(process.env.ARTIFICER_SERVICE_PORT));\n",
  );
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${serverFile}`, portRange: [41220, 41229] },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  // Give the HTTP server a moment to bind before checking it.
  await new Promise((r) => setTimeout(r, 300));
  const result = await manager.check(ws.id, 'web');
  assert.equal((result as { status: number }).status, 200);
  assert.equal((result as { body: string }).body, 'ok');
  await manager.stop(ws.id, 'web');
});

test('check errors for a service that was never started', async () => {
  const { store, config, ws } = await setup();
  const manager = new ServiceManager(store, config);
  const result = await manager.check(ws.id, 'web');
  assert.equal(result.status, 'error');
});

test('teardownWorkstream stops every tracked service', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41230, 41239] },
    worker: { run: `${process.execPath} ${script}`, portRange: [41240, 41249] },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  await manager.start(ws.id, 'worker');
  await manager.teardownWorkstream(ws.id);
  const listed = await manager.list(ws.id);
  assert.equal(listed.length, 0);
});

test('reconcileAll drops dead entries and keeps alive ones claimed', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41250, 41259] },
  });
  const manager = new ServiceManager(store, config);
  const started = await manager.start(ws.id, 'web');
  assert.equal(started.status, 'started');

  // Simulate a dead entry alongside the live one.
  const stateFile = store.layout.workstreamServicesStateFile(ws.id);
  const states = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  states.push({
    name: 'ghost',
    pid: 999_999,
    port: 41258,
    startedAt: new Date().toISOString(),
    script: 'dead',
  });
  fs.writeFileSync(stateFile, JSON.stringify(states));

  const fresh = new ServiceManager(store, config);
  await fresh.reconcileAll();
  const listed = await fresh.list(ws.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'web');

  await fresh.stop(ws.id, 'web');
});
