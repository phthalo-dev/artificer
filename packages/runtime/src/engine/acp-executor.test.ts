import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import type { AcpExecutorConfig } from '../api/types.js';
import { emptyUsage, type RunRecord } from '../storage/types.js';
import { AcpExecutor } from './acp-executor.js';
import type { ExecutorResult } from './executor.js';

const exec = promisify(execFile);
const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'fake-acp-agent.mjs',
);

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args);
  return stdout;
}

async function repo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-acp-repo-'));
  await git(['-C', dir, 'init', '-q', '-b', 'main']);
  await git(['-C', dir, 'config', 'user.email', 't@t.test']);
  await git(['-C', dir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
  await git(['-C', dir, 'add', '-A']);
  await git(['-C', dir, 'commit', '-q', '-m', 'init']);
  return dir;
}

const runRecord: RunRecord = {
  id: 'run-1',
  role: 'worker',
  task: 't',
  status: 'running',
  toolCalls: [],
  usage: emptyUsage(),
  createdAt: new Date().toISOString(),
};

type Record = { pid?: number; method?: string; params?: any } & {
  [key: string]: any;
};

async function readRecords(file: string): Promise<Record[]> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record);
  } catch {
    return [];
  }
}

async function run(
  t: TestContext,
  scenario: object,
  overrides: Partial<AcpExecutorConfig> = {},
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-acp-'));
  const workspaceDir = await repo();
  const recordFile = path.join(dir, 'record.jsonl');
  const scenarioPath = path.join(dir, 'scenario.json');
  await fs.writeFile(
    scenarioPath,
    JSON.stringify({ steps: [], recordFile, ...scenario }),
  );
  t.after(async () => {
    const [first] = await readRecords(recordFile);
    if (first?.pid) {
      try {
        process.kill(-first.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });
  const executor = new AcpExecutor({
    type: 'acp',
    command: process.execPath,
    args: [FAKE, scenarioPath],
    ...overrides,
  });
  const promise: Promise<ExecutorResult> = executor.execute({
    context: 'do the thing',
    workspaceDir,
    run: runRecord,
  });
  // Rejections are asserted by the tests; avoid unhandled-rejection noise.
  promise.catch(() => {});
  return {
    executor,
    workspaceDir,
    promise,
    records: () => readRecords(recordFile),
  };
}

function requests(records: Record[], method: string): Record[] {
  return records.filter((r) => r.method === method);
}

test('happy path returns concatenated text and status', async (t) => {
  const { executor, promise } = await run(t, {
    steps: [
      { type: 'message', text: 'Hello ' },
      { type: 'message', text: 'world' },
      { type: 'reportStatus', status: 'done', summary: 'ok' },
    ],
  });
  const result = await promise;
  assert.equal(result.text, 'Hello world');
  assert.equal(result.workerStatus, 'done');
  assert.equal(result.workerSummary, 'ok');
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(typeof result.sessionId, 'string');
  assert.equal(executor.name, 'acp:node');
  assert.equal(executor.resumesSession, false);
});

test('session/new carries cwd and artificer-status mcp server', async (t) => {
  const { promise, records, workspaceDir } = await run(t, {
    steps: [{ type: 'message', text: 'hi' }],
  });
  await promise;
  const [newSession] = requests(await records(), 'session/new');
  assert.ok(newSession);
  assert.equal(newSession.params.cwd, workspaceDir);
  assert.equal(newSession.params.mcpServers[0].name, 'artificer-status');
  assert.equal(newSession.params.mcpServers[0].command, process.execPath);
});

test('initialize advertises no fs/terminal', async (t) => {
  const { promise, records } = await run(t, {
    steps: [{ type: 'message', text: 'hi' }],
  });
  await promise;
  const [init] = requests(await records(), 'initialize');
  assert.ok(init);
  assert.deepEqual(init.params.clientCapabilities, {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
  });
  assert.equal(init.params.clientInfo.name, 'artificer');
  assert.equal(typeof init.params.clientInfo.version, 'string');
});

test('mode is set when configured and advertised', async (t) => {
  const { promise, records } = await run(
    t,
    {
      modes: {
        currentModeId: 'code',
        availableModes: [
          { id: 'code', name: 'Code' },
          { id: 'ask', name: 'Ask' },
        ],
      },
      steps: [{ type: 'message', text: 'hi' }],
    },
    { mode: 'ask' },
  );
  await promise;
  const setMode = requests(await records(), 'session/set_mode');
  assert.equal(setMode.length, 1);
  assert.equal(setMode[0]?.params.modeId, 'ask');
});

test('mode is not set when the agent does not advertise it', async (t) => {
  const { promise, records } = await run(
    t,
    {
      modes: {
        currentModeId: 'code',
        availableModes: [{ id: 'code', name: 'Code' }],
      },
      steps: [{ type: 'message', text: 'hi' }],
    },
    { mode: 'ask' },
  );
  await promise;
  assert.equal(requests(await records(), 'session/set_mode').length, 0);
});

test('max_tokens stop reason appends marker', async (t) => {
  const { promise } = await run(t, {
    steps: [{ type: 'message', text: 'partial' }],
    stopReason: 'max_tokens',
  });
  const result = await promise;
  assert.equal(result.text, 'partial\n\n[agent stopped: max_tokens]');
});

test('refusal stop reason appends marker', async (t) => {
  const { promise } = await run(t, {
    steps: [{ type: 'message', text: 'no' }],
    stopReason: 'refusal',
  });
  const result = await promise;
  assert.ok(result.text.endsWith('\n\n[agent stopped: refusal]'));
});

test('no status report resolves with text only', async (t) => {
  const { promise } = await run(t, {
    steps: [{ type: 'message', text: 'just text' }],
  });
  const result = await promise;
  assert.equal(result.text, 'just text');
  assert.equal(result.workerStatus, undefined);
  assert.equal(result.workerSummary, undefined);
});

test('empty output resolves with (no output)', async (t) => {
  const { promise } = await run(t, { steps: [] });
  const result = await promise;
  assert.equal(result.text, '(no output)');
});

test('crash mid-prompt rejects with exit code and stderr tail', async (t) => {
  const { promise } = await run(t, {
    steps: [
      { type: 'message', text: 'about to crash' },
      { type: 'crash', code: 3 },
    ],
  });
  await assert.rejects(promise, (err: Error) => {
    assert.match(err.message, /exited with code 3/);
    assert.match(err.message, /fake-acp-agent: crashing/);
    return true;
  });
});

test('JSON-RPC error on session/new rejects with method name', async (t) => {
  const { promise } = await run(t, {
    newSessionError: { code: -32603, message: 'boom' },
  });
  await assert.rejects(promise, (err: Error) => {
    assert.match(err.message, /session\/new/);
    assert.match(err.message, /boom/);
    return true;
  });
});

test('auth error on session/new reports not signed in', async (t) => {
  const { promise } = await run(t, {
    newSessionError: { code: -32000, message: 'Authentication required' },
    authMethods: [{ id: 'x', name: 'Log in with X' }],
  });
  await assert.rejects(promise, {
    message: 'acp:node is not signed in on this host: Log in with X',
  });
});

test('non-JSON stdout fails fast', async (t) => {
  const { promise } = await run(t, {
    preStdout: 'Welcome!\n',
    steps: [{ type: 'hang' }],
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('did not fail fast')), 5_000);
  });
  try {
    await assert.rejects(Promise.race([promise, timeout]), (err: Error) => {
      assert.notEqual(err.message, 'did not fail fast');
      assert.match(err.message, /invalid/);
      assert.match(err.message, /Welcome!/);
      return true;
    });
  } finally {
    clearTimeout(timer);
  }
});

test('missing binary rejects with command name', async (t) => {
  const { promise, executor } = await run(
    t,
    {},
    { command: '/nonexistent/acp-agent' },
  );
  assert.equal(executor.name, 'acp:acp-agent');
  await assert.rejects(promise, (err: Error) => {
    assert.match(err.message, /\/nonexistent\/acp-agent/);
    return true;
  });
});

test('agent process exits after a successful run', async (t) => {
  const { promise, records } = await run(t, {
    steps: [{ type: 'message', text: 'bye' }],
  });
  await promise;
  const [first] = await records();
  assert.ok(first?.pid);
  assert.throws(() => process.kill(first.pid!, 0));
});
