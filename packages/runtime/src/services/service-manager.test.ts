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
  fs.writeFileSync(file, 'setInterval(() => {}, 1000);\n');
  return file;
}

function crashingScript(dir: string): string {
  const file = path.join(dir, 'crash.mjs');
  fs.writeFileSync(file, 'process.exit(1);\n');
  return file;
}

function isPidAliveForTest(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidToDie(pid: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isPidAliveForTest(pid)) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function waitForFileContent(
  file: string,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf-8').trim();
      if (content) return content;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for content in ${file}`);
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
        fs.readFileSync(
          store.layout.workstreamServicesStateFile(ws.id),
          'utf-8',
        ),
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
        fs.readFileSync(
          store.layout.workstreamServicesStateFile(ws.id),
          'utf-8',
        ),
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

test("concurrent start calls for two different services in the same workstream do not clobber each other's state entry", async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41300, 41309] },
    worker: { run: `${process.execPath} ${script}`, portRange: [41310, 41319] },
  });
  const manager = new ServiceManager(store, config);

  // These are DIFFERENT services, so the per-service lock does not
  // serialize them - before the fix, each reads the (empty) state array
  // up front and, ~1.5s later, writes back `[...thatStaleSnapshot, self]`,
  // so whichever writes last silently erases the other's entry.
  const [webResult, workerResult] = await Promise.all([
    manager.start(ws.id, 'web'),
    manager.start(ws.id, 'worker'),
  ]);
  assert.equal(webResult.status, 'started');
  assert.equal(workerResult.status, 'started');

  const states = JSON.parse(
    fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
  );
  const names = states.map((s: { name: string }) => s.name).sort();
  assert.deepEqual(
    names,
    ['web', 'worker'],
    'both services must survive in the state file - neither write may clobber the other',
  );

  for (const s of states) process.kill(s.pid, 'SIGKILL');
});

test('concurrent start and stop for the same service do not race', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41160, 41169] },
  });
  const manager = new ServiceManager(store, config);

  // Fire start() and stop() back-to-back in the same synchronous tick,
  // before either has a chance to resolve.
  const startPromise = manager.start(ws.id, 'web');
  const stopPromise = manager.stop(ws.id, 'web');

  const [startResult, stopResult] = await Promise.all([
    startPromise,
    stopPromise,
  ]);

  // Neither call should have thrown (Promise.all above would have rejected
  // if either did), and start() must have actually succeeded (it was queued
  // first, so it should run to completion before stop() begins).
  assert.equal(startResult.status, 'started');
  // stop() ran after start() completed, so it should see a real running
  // service and actually stop it - not silently no-op against stale state.
  assert.equal(stopResult.status, 'stopped');

  const listed = await manager.list(ws.id);
  const web = listed.find((s) => s.name === 'web');
  // Either the entry was pruned from state entirely, or it's present but
  // reported as stopped. It must NOT be reported as running - that would
  // mean stop() raced start() and left a live process untracked as "stopped".
  assert.ok(!web || web.status === 'stopped');

  if (web && web.status === 'running') {
    // Defensive cleanup so a failing run doesn't leak a process; harmless
    // no-op once the fix makes this branch unreachable.
    const states = JSON.parse(
      fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
    );
    const entry = states.find((s: { name: string }) => s.name === 'web');
    if (entry) process.kill(entry.pid, 'SIGKILL');
  }
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
    web: {
      run: `${process.execPath} ${serverFile}`,
      portRange: [41220, 41229],
    },
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

test("start releases a dead service's port on restart, so repeated crash+restart cycles do not exhaust a small port range", async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  // Only two ports in range - if the dead entry's port were never released
  // on restart, the 3rd cycle here would exhaust the range and doStart's
  // portAllocator.allocate() would throw instead of returning 'started'.
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41330, 41331] },
  });
  const manager = new ServiceManager(store, config);
  const stateFile = store.layout.workstreamServicesStateFile(ws.id);

  for (let cycle = 0; cycle < 4; cycle += 1) {
    const started = await manager.start(ws.id, 'web');
    assert.equal(
      started.status,
      'started',
      `cycle ${cycle} should start (old ports must have been released)`,
    );
    if (started.status !== 'started') continue;

    const states = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const entry = states.find((s: { name: string }) => s.name === 'web');
    assert.ok(entry, `cycle ${cycle} recorded a state entry`);

    // Simulate an external crash: kill the process out-of-band, bypassing
    // manager.stop(), leaving behind a state entry whose pid is dead and
    // whose port is still marked claimed - exactly the situation doStart's
    // "existing but not alive" branch must release before allocating anew.
    process.kill(entry.pid, 'SIGKILL');
    await waitForPidToDie(entry.pid);
  }
});

test('stop releases the port of an already-dead service instead of leaking it', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  // Exactly one port in range - restarting only succeeds if stop()
  // released the dead entry's port instead of leaking it.
  writeServiceConfig(repoRoot, {
    web: { run: `${process.execPath} ${script}`, portRange: [41340, 41340] },
  });
  const manager = new ServiceManager(store, config);

  const started = await manager.start(ws.id, 'web');
  assert.equal(started.status, 'started');
  if (started.status !== 'started') return;

  const stateFile = store.layout.workstreamServicesStateFile(ws.id);
  const states = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  const entry = states.find((s: { name: string }) => s.name === 'web');
  assert.ok(entry);

  // Kill it out-of-band so stop() finds an "already dead" entry rather
  // than a live process to terminate.
  process.kill(entry.pid, 'SIGKILL');
  await waitForPidToDie(entry.pid);

  const stopped = await manager.stop(ws.id, 'web');
  assert.equal(stopped.status, 'already_stopped');

  const restarted = await manager.start(ws.id, 'web');
  assert.equal(
    restarted.status,
    'started',
    'the single port in range must have been released by stop()',
  );
  if (restarted.status === 'started') {
    const finalStates = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const finalEntry = finalStates.find(
      (s: { name: string }) => s.name === 'web',
    );
    process.kill(finalEntry.pid, 'SIGKILL');
  }
});

test("rejects state entries with an untrusted pid (0, negative, or the runtime's own pid), keeping only the valid entry", async () => {
  const { store, config, ws } = await setup();
  const stateFile = store.layout.workstreamServicesStateFile(ws.id);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify([
      {
        name: 'zero-pid',
        pid: 0,
        port: 41400,
        startedAt: new Date().toISOString(),
        script: 'evil',
      },
      {
        name: 'negative-pid',
        pid: -1,
        port: 41401,
        startedAt: new Date().toISOString(),
        script: 'evil',
      },
      {
        name: 'runtime-own-pid',
        pid: process.pid,
        port: 41402,
        startedAt: new Date().toISOString(),
        script: 'evil',
      },
      {
        name: 'valid',
        pid: 999_999,
        port: 41403,
        startedAt: new Date().toISOString(),
        script: 'fine',
      },
    ]),
  );

  const manager = new ServiceManager(store, config);
  const listed = await manager.list(ws.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'valid');
});

test('check() does not follow a redirect returned by the service - it resolves using the first response', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const serverFile = path.join(repoRoot, 'redirecting-server.mjs');
  fs.writeFileSync(
    serverFile,
    "import http from 'node:http';\n" +
      'http.createServer((_, res) => {\n' +
      "  res.writeHead(302, { Location: 'http://example.com' });\n" +
      "  res.end('redirecting');\n" +
      '}).listen(Number(process.env.ARTIFICER_SERVICE_PORT));\n',
  );
  writeServiceConfig(repoRoot, {
    web: {
      run: `${process.execPath} ${serverFile}`,
      portRange: [41410, 41419],
    },
  });
  const manager = new ServiceManager(store, config);
  await manager.start(ws.id, 'web');
  await new Promise((r) => setTimeout(r, 300));

  const result = await manager.check(ws.id, 'web');
  // If check() had followed the redirect, it would have tried to contact
  // http://example.com - unreachable/blocked in this sandbox - and either
  // hung until the 5s timeout (returning status: 'error') or, on a machine
  // with real network access, silently returned example.com's status/body
  // instead of the service's own 302. Either way it would NOT be 302 with
  // this body.
  assert.equal((result as { status: number }).status, 302);
  assert.equal((result as { body: string }).body, 'redirecting');

  await manager.stop(ws.id, 'web');
});

test(
  'stop kills the whole process group, not just the tracked shell wrapper pid',
  { skip: process.platform === 'win32' },
  async () => {
    const { store, config, ws, repoRoot } = await setup();
    const pidFile = path.join(repoRoot, 'grandchild.pid');
    // The run script backgrounds a real, independent node process (the
    // "grandchild" from the shell wrapper's perspective) and writes its own
    // pid to a file, then `wait`s on it - keeping the tracked wrapper pid
    // (the `sh -c ...` process itself) alive so start() sees a long-lived
    // service, exactly like a real `npm run dev` wrapping a dev server.
    const runCommand = `${process.execPath} -e "setInterval(()=>{},1000)" & echo $! > ${pidFile} ; wait`;
    writeServiceConfig(repoRoot, {
      web: { run: runCommand, portRange: [41420, 41429] },
    });
    const manager = new ServiceManager(store, config);

    const started = await manager.start(ws.id, 'web');
    assert.equal(started.status, 'started');

    const grandchildPid = Number(await waitForFileContent(pidFile));
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0);
    assert.ok(
      isPidAliveForTest(grandchildPid),
      'grandchild should be alive right after start',
    );

    const stopped = await manager.stop(ws.id, 'web');
    assert.equal(stopped.status, 'stopped');

    await waitForPidToDie(grandchildPid);
    assert.ok(
      !isPidAliveForTest(grandchildPid),
      'grandchild must be dead - killing only the shell wrapper would leave it running',
    );
  },
);

test('setup and run both receive ARTIFICER_SERVICE_PORT/NAME, and setup sees them before run starts', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  const setupMarker = path.join(repoRoot, 'setup-env.txt');
  writeServiceConfig(repoRoot, {
    web: {
      setup: `echo "$ARTIFICER_SERVICE_PORT $ARTIFICER_SERVICE_NAME" > ${setupMarker}`,
      run: `${process.execPath} ${script}`,
      portRange: [41430, 41439],
    },
  });
  const manager = new ServiceManager(store, config);
  const result = await manager.start(ws.id, 'web');
  assert.equal(result.status, 'started');
  if (result.status !== 'started') return;

  const written = fs.readFileSync(setupMarker, 'utf-8').trim();
  assert.equal(written, `${result.port} web`);

  process.kill(
    JSON.parse(
      fs.readFileSync(store.layout.workstreamServicesStateFile(ws.id), 'utf-8'),
    )[0].pid,
    'SIGKILL',
  );
});

test('teardown receives ARTIFICER_SERVICE_PORT/NAME for the service being stopped', async () => {
  const { store, config, ws, repoRoot } = await setup();
  const script = longLivedScript(repoRoot);
  const teardownMarker = path.join(repoRoot, 'teardown-env.txt');
  writeServiceConfig(repoRoot, {
    web: {
      run: `${process.execPath} ${script}`,
      teardown: `echo "$ARTIFICER_SERVICE_PORT $ARTIFICER_SERVICE_NAME" > ${teardownMarker}`,
      portRange: [41440, 41449],
    },
  });
  const manager = new ServiceManager(store, config);
  const started = await manager.start(ws.id, 'web');
  assert.equal(started.status, 'started');
  if (started.status !== 'started') return;

  const stopped = await manager.stop(ws.id, 'web');
  assert.equal(stopped.status, 'stopped');

  const written = fs.readFileSync(teardownMarker, 'utf-8').trim();
  assert.equal(written, `${started.port} web`);
});
