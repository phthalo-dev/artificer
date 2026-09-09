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
