import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import type { AcpExecutorConfig } from '../api/types.js';
import type { RuntimeEvent } from '../context.js';
import {
  emptyUsage,
  type RunRecord,
  type ToolInvocation,
} from '../storage/types.js';
import { shellApprovalKey, type ToolPolicyFile } from '../tools/tool-policy.js';
import { AcpExecutor } from './acp-executor.js';
import { isStaleSessionError } from './conversation-turn.js';
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
  extra: {
    policy?: ToolPolicyFile;
    role?: string;
    onToolCall?: (invocation: ToolInvocation) => void;
    emit?: (event: RuntimeEvent) => void;
    signal?: AbortSignal;
    sessionId?: string;
    /** Effective base role passed to execute (run.role stays as set by `role`). */
    executeRole?: string;
    cancelGraceMs?: number;
    /** Run as the codex preset, launched through a fake `npx` on PATH. */
    codex?: { env?: Record<string, string> };
    stateDir?: string;
    /** Prepare the workspace before the run starts. */
    setup?: (workspaceDir: string) => Promise<void>;
  } = {},
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-acp-'));
  const stateDir = extra.stateDir ?? path.join(dir, 'acp');
  const workspaceDir = await repo();
  await extra.setup?.(workspaceDir);
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
  let config: AcpExecutorConfig = {
    type: 'acp',
    command: process.execPath,
    args: [FAKE, scenarioPath],
    ...overrides,
  };
  if (extra.codex) {
    const bin = path.join(dir, 'bin');
    await fs.mkdir(bin);
    await fs.writeFile(
      path.join(bin, 'npx'),
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} ${JSON.stringify(scenarioPath)}\n`,
      { mode: 0o755 },
    );
    config = {
      type: 'acp',
      agent: 'codex',
      ...overrides,
      env: {
        CODEX_API_KEY: 'k',
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        ...extra.codex.env,
      },
    };
  }
  const executor = new AcpExecutor(config, {
    stateDir,
    ...(extra.cancelGraceMs !== undefined
      ? { cancelGraceMs: extra.cancelGraceMs }
      : {}),
  });
  const promise: Promise<ExecutorResult> = executor.execute({
    context: 'do the thing',
    workspaceDir,
    run: extra.role ? { ...runRecord, role: extra.role } : runRecord,
    policy: extra.policy,
    onToolCall: extra.onToolCall,
    emit: extra.emit,
    signal: extra.signal,
    sessionId: extra.sessionId,
    ...(extra.executeRole ? { role: extra.executeRole } : {}),
  });
  // Rejections are asserted by the tests; avoid unhandled-rejection noise.
  promise.catch(() => {});
  return {
    executor,
    workspaceDir,
    stateDir,
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

const MODEL_OPTIONS = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'opencode/a',
    options: [
      { value: 'opencode/a', name: 'A' },
      { value: 'opencode/b', name: 'B' },
    ],
  },
];

test('model is set via set_config_option', async (t) => {
  const { promise, records } = await run(
    t,
    {
      configOptions: MODEL_OPTIONS,
      steps: [{ type: 'message', text: 'hi' }],
    },
    { model: 'opencode/b' },
  );
  await promise;
  const recs = await records();
  const set = requests(recs, 'session/set_config_option');
  assert.equal(set.length, 1);
  assert.equal(set[0]?.params.configId, 'model');
  assert.equal(set[0]?.params.value, 'opencode/b');
  const methodsSeen = recs.map((r: { method?: string }) => r.method);
  assert.ok(
    methodsSeen.indexOf('session/set_config_option') <
      methodsSeen.indexOf('session/prompt'),
  );
});

test('model equal to current is not re-set', async (t) => {
  const { promise, records } = await run(
    t,
    {
      configOptions: MODEL_OPTIONS,
      steps: [{ type: 'message', text: 'hi' }],
    },
    { model: 'opencode/a' },
  );
  await promise;
  assert.equal(
    requests(await records(), 'session/set_config_option').length,
    0,
  );
});

test('unknown model rejects before prompt', async (t) => {
  const { promise, records } = await run(
    t,
    {
      configOptions: MODEL_OPTIONS,
      steps: [{ type: 'message', text: 'hi' }],
    },
    { model: 'opencode/zzz' },
  );
  await assert.rejects(
    promise,
    (err: Error) =>
      err.message ===
      'acp:node does not offer model opencode/zzz; available: opencode/a, opencode/b',
  );
  assert.equal(requests(await records(), 'session/prompt').length, 0);
});

test('model without model option rejects', async (t) => {
  const { promise } = await run(
    t,
    { configOptions: [], steps: [{ type: 'message', text: 'hi' }] },
    { model: 'opencode/a' },
  );
  await assert.rejects(
    promise,
    (err: Error) => err.message === 'acp:node does not support model selection',
  );
});

test('model on resume without configOptions rejects', async (t) => {
  const { promise } = await run(
    t,
    {
      agentCapabilities: { sessionCapabilities: { resume: {} } },
      configOptions: MODEL_OPTIONS,
      resumeConfigOptions: null,
      steps: [{ type: 'message', text: 'hi' }],
    },
    { model: 'opencode/b', resumes: true },
    { sessionId: 's1' },
  );
  await assert.rejects(
    promise,
    (err: Error) => err.message === 'acp:node does not support model selection',
  );
});

test('no model configured sends no set_config_option', async (t) => {
  const { promise, records } = await run(t, {
    configOptions: MODEL_OPTIONS,
    steps: [{ type: 'message', text: 'hi' }],
  });
  await promise;
  assert.equal(
    requests(await records(), 'session/set_config_option').length,
    0,
  );
});

test('max_tokens stop reason appends marker', async (t) => {
  const { promise } = await run(t, {
    steps: [{ type: 'message', text: 'partial' }],
    stopReason: 'max_tokens',
  });
  const result = await promise;
  assert.equal(result.text, 'partial\n\n[agent stopped: max_tokens]');
});

test('agent-initiated cancelled is a stop marker', async (t) => {
  const { promise } = await run(t, {
    steps: [{ type: 'message', text: 'partial' }],
    stopReason: 'cancelled',
  });
  const result = await promise;
  assert.equal(result.text, 'partial\n\n[agent stopped: cancelled]');
});

test('prompt usage is returned', async (t) => {
  const { promise } = await run(t, {
    steps: [{ type: 'message', text: 'x' }],
    promptUsage: { inputTokens: 120, outputTokens: 7, totalTokens: 300 },
  });
  assert.deepEqual((await promise).usage, {
    inputTokens: 120,
    outputTokens: 7,
  });
});

test('malformed usage falls back to zeros', async (t) => {
  for (const promptUsage of [{ inputTokens: '12', outputTokens: -1 }, null]) {
    const { promise } = await run(t, {
      steps: [{ type: 'message', text: 'x' }],
      promptUsage,
    });
    assert.deepEqual((await promise).usage, {
      inputTokens: 0,
      outputTokens: 0,
    });
  }
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

const GATE_OPTIONS = [
  { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
  { optionId: 'r1', name: 'Reject', kind: 'reject_once' },
];

async function runTools(
  t: TestContext,
  steps: object[],
  extra: Parameters<typeof run>[3] = {},
) {
  const calls: ToolInvocation[] = [];
  const events: RuntimeEvent[] = [];
  const r = await run(
    t,
    { steps },
    {},
    {
      ...extra,
      onToolCall: (i) => calls.push(i),
      emit: (e) => events.push(e),
    },
  );
  await r.promise;
  return { ...r, calls, events };
}

function permissionResponse(records: Record[]): Record | undefined {
  return records.find((r) => r.permissionResponse);
}

test('completed tool calls are reported once each', async (t) => {
  const { calls } = await runTools(t, [
    { type: 'tool', id: 't1', title: 'Read a.txt', kind: 'read', output: 'x' },
    { type: 'tool', id: 't2', title: 'ls', kind: 'execute', output: 'y' },
  ]);
  assert.deepEqual(
    calls.map((c) => c.name),
    ['acp:read', 'acp:execute'],
  );
});

test('permission decisions are recorded via onToolCall', async (t) => {
  const { calls, events } = await runTools(t, [
    {
      type: 'tool',
      id: 't1',
      title: 'rm -rf build',
      kind: 'execute',
      rawInput: { command: 'rm -rf build' },
      askPermission: true,
      options: GATE_OPTIONS,
      output: 'removed',
    },
  ]);
  const perms = calls.filter((c) => c.name === 'acp:permission');
  assert.equal(perms.length, 1);
  assert.deepEqual(perms[0].input, {
    tool: 'run_shell',
    approvalKey: shellApprovalKey('rm -rf build'),
  });
  assert.equal(perms[0].output, 'deny');
  // onToolCall owns the live event; the executor must not emit it twice.
  assert.equal(
    events.filter((e) => e.kind === 'tool' && e.data.name === 'acp:permission')
      .length,
    0,
  );
  // The agent's own tool call is still reported after the decision.
  assert.deepEqual(
    calls.map((c) => c.name),
    ['acp:permission', 'acp:execute'],
  );
});

test('tool output text is extracted', async (t) => {
  const { calls } = await runTools(t, [
    {
      type: 'tool',
      id: 't1',
      title: 'Read a.txt',
      kind: 'read',
      rawInput: { path: 'a.txt' },
      output: 'file contents',
    },
  ]);
  assert.equal(calls[0].output, 'file contents');
  assert.deepEqual(calls[0].input, {
    title: 'Read a.txt',
    rawInput: { path: 'a.txt' },
  });
  assert.equal(calls[0].error, undefined);
});

test('large tool output is truncated', async (t) => {
  const { calls } = await runTools(t, [
    {
      type: 'tool',
      id: 't1',
      title: 'dump',
      kind: 'read',
      output: 'z'.repeat(100_000),
    },
  ]);
  const suffix = '…[truncated]';
  assert.ok(calls[0].output.length <= 8192 + suffix.length);
  assert.ok(calls[0].output.endsWith(suffix));
});

test('gated execute without rule is rejected and approval emitted', async (t) => {
  const { calls, events, records } = await runTools(t, [
    {
      type: 'tool',
      id: 't1',
      title: 'rm -rf build',
      kind: 'execute',
      rawInput: { command: 'rm -rf build' },
      askPermission: true,
      options: GATE_OPTIONS,
      output: 'removed',
    },
  ]);
  const res = permissionResponse(await records());
  assert.equal(res?.permissionResponse.outcome.optionId, 'r1');
  const approval = events.find((e) => e.kind === 'approval');
  assert.ok(approval && approval.kind === 'approval');
  assert.equal(approval.data.proposedRule.tool, 'run_shell');
  assert.equal(approval.data.runId, 'run-1');
  assert.equal(calls.find((c) => c.name === 'acp:execute')?.error, 'failed');
  assert.ok(calls.find((c) => c.name === 'acp:permission'));
});

test('permission request is filled from tracked tool call', async (t) => {
  const { events, records } = await runTools(t, [
    {
      type: 'tool',
      id: 'exec-1',
      title: 'rm -rf build',
      kind: 'execute',
      rawInput: { command: 'rm -rf build' },
      askPermission: true,
      options: GATE_OPTIONS,
      permissionToolCall: {
        toolCallId: 'exec-1',
        kind: 'execute',
        status: 'pending',
      },
      output: 'removed',
    },
  ]);
  const res = permissionResponse(await records());
  assert.equal(res?.permissionResponse.outcome.optionId, 'r1');
  const approval = events.find((e) => e.kind === 'approval');
  assert.ok(approval && approval.kind === 'approval');
  assert.equal(
    approval.data.proposedRule.pattern,
    shellApprovalKey('rm -rf build'),
  );
});

test('MCP approval is filled from tracked tool call and allowed', async (t) => {
  const { calls, records } = await runTools(t, [
    {
      type: 'tool',
      id: 'exec-mcp',
      title: 'mcp.artificer-status.report_status',
      kind: 'execute',
      rawInput: {
        server: 'artificer-status',
        tool: 'report_status',
        arguments: { status: 'done', summary: 'ok' },
      },
      toolCallMeta: { is_mcp_tool_call: true },
      askPermission: true,
      options: GATE_OPTIONS,
      permissionToolCall: {
        toolCallId: 'exec-mcp',
        kind: 'execute',
        status: 'pending',
      },
      permissionMeta: { is_mcp_tool_approval: true },
      output: 'ok',
    },
  ]);
  const all = await records();
  assert.equal(
    permissionResponse(all)?.permissionResponse.outcome.optionId,
    'a1',
  );
  const perm = calls.find((c) => c.name === 'acp:permission');
  assert.deepEqual(perm?.input, {
    tool: 'mcp:artificer-status.report_status',
    approvalKey: 'artificer-status.report_status',
  });
});

test('tracked is_mcp_tool_call flag alone allows artificer-status', async (t) => {
  const { calls } = await runTools(t, [
    {
      type: 'tool',
      id: 'exec-mcp',
      title: 'mcp.artificer-status.report_status',
      kind: 'execute',
      rawInput: { server: 'artificer-status', tool: 'report_status' },
      toolCallMeta: { is_mcp_tool_call: true },
      askPermission: true,
      options: GATE_OPTIONS,
      permissionToolCall: {
        toolCallId: 'exec-mcp',
        kind: 'execute',
        status: 'pending',
      },
      output: 'ok',
    },
  ]);
  const perm = calls.find((c) => c.name === 'acp:permission');
  assert.equal(perm?.output, 'allow');
  assert.equal(
    (perm?.input as { tool: string }).tool,
    'mcp:artificer-status.report_status',
  );
});

test('without onToolCall the permission decision is emitted live', async (t) => {
  const events: RuntimeEvent[] = [];
  const { promise } = await run(
    t,
    {
      steps: [
        {
          type: 'tool',
          id: 't1',
          title: 'ls',
          kind: 'execute',
          rawInput: { command: 'ls' },
          askPermission: true,
          options: GATE_OPTIONS,
          output: 'x',
        },
      ],
    },
    {},
    { emit: (e) => events.push(e) },
  );
  await promise;
  const perm = events.find(
    (e) => e.kind === 'tool' && e.data.name === 'acp:permission',
  );
  assert.ok(perm && perm.kind === 'tool');
  assert.equal(perm.data.runId, 'run-1');
  assert.equal(perm.data.output, 'allow');
});

test('allow rule lets gated execute through', async (t) => {
  const policy: ToolPolicyFile = {
    version: 1,
    rules: [
      {
        id: 'rule1',
        tool: 'run_shell',
        pattern: shellApprovalKey('rm -rf build'),
        effect: 'allow',
        scope: 'agent',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
  const { calls, events, records } = await runTools(
    t,
    [
      {
        type: 'tool',
        id: 't1',
        title: 'rm -rf build',
        kind: 'execute',
        rawInput: { command: 'rm -rf build' },
        askPermission: true,
        options: GATE_OPTIONS,
        output: 'removed',
      },
    ],
    { policy },
  );
  const res = permissionResponse(await records());
  assert.equal(res?.permissionResponse.outcome.optionId, 'a1');
  assert.equal(calls.find((c) => c.name === 'acp:execute')?.error, undefined);
  assert.equal(events.filter((e) => e.kind === 'approval').length, 0);
});

test('reviewer edits are rejected', async (t) => {
  const { records } = await runTools(
    t,
    [
      {
        type: 'tool',
        id: 't1',
        title: 'Edit a.txt',
        kind: 'edit',
        locations: ['a.txt'],
        askPermission: true,
        options: GATE_OPTIONS,
        output: 'edited',
      },
    ],
    { role: 'reviewer' },
  );
  const res = permissionResponse(await records());
  assert.equal(res?.permissionResponse.outcome.optionId, 'r1');
});

test('custom role with reviewer base role cannot edit', async (t) => {
  const { records } = await runTools(
    t,
    [
      {
        type: 'tool',
        id: 't1',
        title: 'Edit a.txt',
        kind: 'edit',
        locations: ['a.txt'],
        askPermission: true,
        options: GATE_OPTIONS,
        output: 'edited',
      },
    ],
    { role: 'security-auditor', executeRole: 'reviewer' },
  );
  const res = permissionResponse(await records());
  assert.equal(res?.permissionResponse.outcome.optionId, 'r1');
});

test('large tool title and rawInput are bounded', async (t) => {
  const { calls } = await runTools(t, [
    {
      type: 'tool',
      id: 't1',
      title: 'T'.repeat(100_000),
      kind: 'read',
      rawInput: { data: 'R'.repeat(100_000) },
      output: 'ok',
    },
  ]);
  // Oversized input degrades to its truncated JSON string, so the string
  // itself is the stringified input and is capped at 8 KiB plus the suffix.
  const input = calls[0].input;
  assert.equal(typeof input, 'string');
  assert.ok((input as string).length <= 8192 + '…[truncated]'.length);
  assert.ok((input as string).endsWith('…[truncated]'));
});

/** Abort 200 ms after the prompt is in flight, so a session exists to cancel. */
async function abortDuringPrompt(
  records: () => Promise<Record[]>,
  controller: AbortController,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (requests(await records(), 'session/prompt').length === 0) {
    if (Date.now() > deadline) throw new Error('prompt never started');
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 200));
  controller.abort();
}

function assertGone(pid: number | undefined): void {
  assert.ok(pid);
  assert.throws(
    () => process.kill(pid!, 0),
    (err: NodeJS.ErrnoException) => err.code === 'ESRCH',
  );
}

test('abort sends session/cancel and rejects cancelled', async (t) => {
  const controller = new AbortController();
  const { promise, records } = await run(
    t,
    { steps: [{ type: 'hang' }] },
    {},
    { signal: controller.signal },
  );
  await abortDuringPrompt(records, controller);
  await assert.rejects(promise, (err: Error) => err.message === 'cancelled');
  const recs = await records();
  assert.equal(requests(recs, 'session/cancel').length, 1);
  assertGone(recs[0]?.pid);
});

test('agent ignoring cancel is killed within grace', async (t) => {
  const controller = new AbortController();
  const { promise, records } = await run(
    t,
    { ignoreCancel: true, steps: [{ type: 'hang' }] },
    {},
    { signal: controller.signal, cancelGraceMs: 500 },
  );
  await abortDuringPrompt(records, controller);
  const started = Date.now();
  await assert.rejects(promise, (err: Error) => err.message === 'cancelled');
  assert.ok(Date.now() - started < 3_000, 'rejected within the grace');
  const recs = await records();
  assert.equal(requests(recs, 'session/cancel').length, 1);
  assertGone(recs[0]?.pid);
});

test('invalid stdout after cancel does not replace the abort error', async (t) => {
  const controller = new AbortController();
  const { promise, records } = await run(
    t,
    { garbageOnCancel: true, steps: [{ type: 'hang' }] },
    {},
    { signal: controller.signal },
  );
  await abortDuringPrompt(records, controller);
  await assert.rejects(promise, (err: Error) => err.message === 'cancelled');
  assertGone((await records())[0]?.pid);
});

test('timeout rejects with timed out', async (t) => {
  // Long enough that the agent is mid-prompt when the timeout fires, even on a
  // loaded machine: a shorter timeout could fire before the fake agent started
  // (no pid recorded, no session to cancel).
  const { promise, records } = await run(
    t,
    { steps: [{ type: 'hang' }] },
    { timeout: 2_000 },
  );
  await assert.rejects(
    promise,
    (err: Error) => err.message === 'acp:node agent timed out',
  );
  const recorded = await records();
  assert.ok(recorded.some((r) => r.method === 'session/cancel'));
  assertGone(recorded[0]?.pid);
});

test('permission during cancel is cancelled', async (t) => {
  const controller = new AbortController();
  const { promise, records } = await run(
    t,
    { askPermissionAfterCancel: true, steps: [{ type: 'hang' }] },
    {},
    {
      signal: controller.signal,
      // Without cancellation this rule would allow the post-cancel request.
      policy: {
        version: 1,
        rules: [
          {
            id: 'rule1',
            tool: 'run_shell',
            pattern: shellApprovalKey('after cancel'),
            effect: 'allow',
            scope: 'agent',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    },
  );
  await abortDuringPrompt(records, controller);
  await assert.rejects(promise, (err: Error) => err.message === 'cancelled');
  const response = permissionResponse(await records());
  assert.ok(response, 'permission response recorded');
  assert.equal(response.toolCallId, 'after-cancel');
  assert.equal(response.permissionResponse.outcome.outcome, 'cancelled');
});

test('already-aborted signal rejects without spawning', async (t) => {
  const controller = new AbortController();
  controller.abort();
  const { promise, records } = await run(
    t,
    { steps: [{ type: 'message', text: 'hi' }] },
    {},
    { signal: controller.signal },
  );
  await assert.rejects(promise, (err: Error) => err.message === 'cancelled');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await records(), []);
});

test('new session returns its id', async (t) => {
  const { promise } = await run(t, {
    steps: [{ type: 'message', text: 'hi' }],
  });
  assert.equal((await promise).sessionId, 'fake-session-1');
});

test('resume used when advertised', async (t) => {
  const { promise, records } = await run(
    t,
    {
      agentCapabilities: { sessionCapabilities: { resume: {} } },
      steps: [{ type: 'message', text: 'hi' }],
    },
    {},
    { sessionId: 's1' },
  );
  const result = await promise;
  assert.equal(result.sessionId, 's1');
  const recs = await records();
  const resumes = requests(recs, 'session/resume');
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].params.sessionId, 's1');
  assert.equal(resumes[0].params.mcpServers[0].name, 'artificer-status');
  assert.equal(requests(recs, 'session/new').length, 0);
  assert.equal(requests(recs, 'session/prompt')[0].params.sessionId, 's1');
});

test('load used when only loadSession advertised; replayed updates ignored', async (t) => {
  const { promise, records } = await run(
    t,
    {
      agentCapabilities: { loadSession: true },
      loadReplay: 'old',
      steps: [{ type: 'message', text: 'new' }],
    },
    {},
    { sessionId: 's1' },
  );
  const result = await promise;
  assert.equal(result.text, 'new');
  assert.equal(result.sessionId, 's1');
  const recs = await records();
  assert.equal(requests(recs, 'session/load').length, 1);
  assert.equal(requests(recs, 'session/new').length, 0);
});

for (const [label, caps] of [
  ['resume', { sessionCapabilities: { resume: {} } }],
  ['load', { loadSession: true }],
] as const) {
  test(`null ${label} response still resumes the session`, async (t) => {
    const { promise, records } = await run(
      t,
      {
        agentCapabilities: caps,
        nullResumeResponse: true,
        steps: [{ type: 'message', text: 'hi' }],
      },
      {},
      { sessionId: 's1' },
    );
    const result = await promise;
    assert.equal(result.sessionId, 's1');
    assert.equal(result.text, 'hi');
    assert.equal(requests(await records(), `session/${label}`).length, 1);
  });
}

test('agent process starts outside the workspace; session cwd is the workspace', async (t) => {
  const { promise, records, workspaceDir, stateDir } = await run(t, {
    steps: [{ type: 'message', text: 'hi' }],
  });
  await promise;
  const all = await records();
  const real = await fs.realpath(workspaceDir);
  const agentCwd = all[0].cwd as string;
  assert.notEqual(agentCwd, workspaceDir);
  assert.notEqual(agentCwd, real);
  assert.ok(!agentCwd.startsWith(real + path.sep));
  const runParent = await fs.realpath(path.join(stateDir, 'run'));
  assert.equal(path.dirname(agentCwd), runParent);
  assert.equal((await fs.stat(runParent)).mode & 0o777, 0o700);
  // The per-launch directory is removed afterwards.
  await assert.rejects(fs.access(agentCwd));
  assert.equal(requests(all, 'session/new')[0].params.cwd, workspaceDir);
});

test('a relative custom command still resolves against the workspace', async (t) => {
  const { promise, records } = await run(
    t,
    { steps: [{ type: 'message', text: 'rel' }] },
    { command: './bin/agent.sh' },
    {
      setup: async (ws) => {
        await fs.mkdir(path.join(ws, 'bin'));
        await fs.writeFile(
          path.join(ws, 'bin', 'agent.sh'),
          `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
          { mode: 0o755 },
        );
      },
    },
  );
  assert.equal((await promise).text, 'rel');
  assert.ok((await records())[0].pid);
});

test('codex preset: agent env gets the forced CODEX_HOME and npm config', async (t) => {
  const saved = process.env.CODEX_HOME;
  process.env.CODEX_HOME = '/tmp/human-codex';
  t.after(() => {
    if (saved === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved;
  });
  const { promise, records, stateDir, workspaceDir } = await run(
    t,
    { steps: [{ type: 'message', text: 'hi' }] },
    {},
    { codex: {} },
  );
  await promise;
  const [first, ...rest] = await records();
  assert.equal(first.env.CODEX_HOME, path.join(stateDir, 'codex-home'));
  assert.equal(first.env.npm_config_userconfig, path.join(stateDir, 'npmrc'));
  assert.equal(first.env.npm_config_registry, 'https://registry.npmjs.org/');
  assert.equal(await fs.readFile(path.join(stateDir, 'npmrc'), 'utf-8'), '');
  assert.ok(!first.cwd.startsWith(await fs.realpath(workspaceDir)));
  assert.equal(requests(rest, 'session/new')[0].params.cwd, workspaceDir);
});

test('codex preset: a planted CODEX_HOME is reset on spawn, auth.json kept', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-codex-reset-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'acp');
  const home = path.join(stateDir, 'codex-home');
  const victim = path.join(dir, 'victim.txt');
  await fs.mkdir(path.join(home, 'rules'), { recursive: true });
  await fs.mkdir(path.join(home, 'prompts'), { recursive: true });
  await fs.mkdir(path.join(home, 'sessions'), { recursive: true });
  await fs.writeFile(victim, 'keep');
  // A config.toml symlink must be replaced, not written through.
  await fs.symlink(victim, path.join(home, 'config.toml'));
  await fs.writeFile(path.join(home, 'rules', 'x.rules'), 'allow');
  await fs.writeFile(path.join(home, 'AGENTS.md'), 'ignore Artificer');
  await fs.writeFile(path.join(home, 'prompts', 'p.md'), 'p');
  await fs.writeFile(path.join(home, 'auth.json'), '{"k":"v"}');
  await fs.writeFile(path.join(home, 'sessions', 's.jsonl'), '{}');
  await fs.writeFile(
    path.join(stateDir, 'npmrc'),
    'registry=https://evil.test/',
  );

  const { promise } = await run(
    t,
    { steps: [{ type: 'message', text: 'hi' }] },
    {},
    { codex: {}, stateDir },
  );
  await promise;
  const config = await fs.lstat(path.join(home, 'config.toml'));
  assert.ok(config.isFile());
  assert.equal(config.mode & 0o777, 0o600);
  assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf-8'), '');
  await assert.rejects(fs.access(path.join(home, 'rules')));
  await assert.rejects(fs.access(path.join(home, 'AGENTS.md')));
  await assert.rejects(fs.access(path.join(home, 'prompts')));
  assert.equal(
    await fs.readFile(path.join(home, 'auth.json'), 'utf-8'),
    '{"k":"v"}',
  );
  await fs.access(path.join(home, 'sessions', 's.jsonl'));
  assert.equal(await fs.readFile(victim, 'utf-8'), 'keep');
  assert.equal(await fs.readFile(path.join(stateDir, 'npmrc'), 'utf-8'), '');
});

test('state-dir commands are denied with the executor state dir protected', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-protect-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'acp');
  const command = `printf x >> ${stateDir}/codex-home/config.toml`;
  const { calls, records } = await runTools(
    t,
    [
      {
        type: 'tool',
        id: 'exec-state',
        title: command,
        kind: 'execute',
        rawInput: { command },
        askPermission: true,
        options: GATE_OPTIONS,
        output: 'x',
      },
    ],
    { stateDir },
  );
  const res = permissionResponse(await records());
  assert.equal(res?.permissionResponse.outcome.optionId, 'r1');
  const perm = calls.find((c) => c.name === 'acp:permission');
  assert.equal(perm?.output, 'deny: touches Artificer agent state');
});

test('detail-free execute with only a tracked title is denied', async (t) => {
  const { calls, records } = await runTools(t, [
    {
      type: 'tool',
      id: 'exec-title',
      title: 'mcp.evil.exfil',
      kind: 'execute',
      askPermission: true,
      options: GATE_OPTIONS,
      permissionToolCall: { toolCallId: 'exec-title' },
      output: 'x',
    },
  ]);
  const res = permissionResponse(await records());
  assert.equal(res?.permissionResponse.outcome.optionId, 'r1');
  const perm = calls.find((c) => c.name === 'acp:permission');
  assert.equal(perm?.output, 'deny: no command to evaluate');
});

test('a planted node_modules shadow is not run by an npx launch', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-shadow-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'pwned');
  const pkg = 'artificer-shadow-probe';
  const plant = async (ws: string) => {
    const pkgDir = path.join(ws, 'node_modules', pkg);
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(
      path.join(ws, 'package.json'),
      JSON.stringify({
        name: 'ws',
        private: true,
        dependencies: { [pkg]: '1.0.0' },
      }),
    );
    await fs.writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: pkg, version: '1.0.0', bin: { [pkg]: 'bin.js' } }),
    );
    await fs.writeFile(
      path.join(pkgDir, 'bin.js'),
      `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`,
      { mode: 0o755 },
    );
    await fs.mkdir(path.join(ws, 'node_modules', '.bin'));
    await fs.symlink(
      path.join('..', pkg, 'bin.js'),
      path.join(ws, 'node_modules', '.bin', pkg),
    );
  };
  // Offline, and never reaching a registry: the only way npx can run the
  // probe is the shadow.
  const npmEnv = {
    npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:9/',
    npm_config_userconfig: path.join(dir, 'npmrc'),
    npm_config_cache: path.join(dir, 'npm-cache'),
  };
  await fs.writeFile(npmEnv.npm_config_userconfig, '');

  // Control: started in the workspace, npx does run the shadow.
  const control = path.join(dir, 'control');
  await fs.mkdir(control);
  await plant(control);
  await exec('npx', ['--no', pkg], {
    cwd: control,
    env: { ...process.env, ...npmEnv },
  });
  await fs.access(marker);
  await fs.rm(marker);

  const { promise } = await run(
    t,
    {},
    { command: 'npx', args: ['--no', pkg], env: npmEnv, timeout: 60_000 },
    { setup: plant },
  );
  await assert.rejects(promise);
  await assert.rejects(fs.access(marker), 'the workspace shadow ran');
});

test('no resume capability gives a stale-session error', async (t) => {
  const { promise } = await run(t, {}, {}, { sessionId: 's1' });
  await assert.rejects(promise, (err: Error) => {
    assert.equal(err.message, 'session not found: s1');
    assert.ok(isStaleSessionError(err));
    return true;
  });
});

test('a resume or load JSON-RPC error gives a stale-session error', async (t) => {
  const { promise } = await run(
    t,
    {
      agentCapabilities: { loadSession: true },
      loadError: { code: -32002, message: 'nope' },
    },
    {},
    { sessionId: 's9' },
  );
  await assert.rejects(promise, /^Error: session not found: s9$/);
});

test('codex executor creates its CODEX_HOME with mode 0700', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-codex-home-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'acp');
  const ex = new AcpExecutor(
    { type: 'acp', agent: 'codex', env: { CODEX_API_KEY: 'k' } },
    { stateDir },
  );
  assert.equal(ex.name, 'acp:codex');
  const st = await fs.stat(path.join(stateDir, 'codex-home'));
  assert.ok(st.isDirectory());
  assert.equal(st.mode & 0o777, 0o700);
});
