#!/usr/bin/env node
/**
 * Scripted ACP agent for AcpExecutor tests.
 *
 * Usage: node fake-acp-agent.mjs <scenario.json>
 *
 * The first line of `scenario.recordFile` is `{ pid }`. Every received
 * request and notification is appended as `{ method, params }` exactly as it
 * arrived on the wire, and
 * every permission response as `{ permissionResponse, toolCallId }`.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import { Readable, Writable } from 'node:stream';
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from '@agentclientprotocol/sdk';

const scenario = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const steps = scenario.steps ?? [];

fs.writeFileSync(
  scenario.recordFile,
  JSON.stringify({ pid: process.pid }) + '\n',
);

function record(entry) {
  fs.appendFileSync(scenario.recordFile, JSON.stringify(entry) + '\n');
}

function rpcError(spec) {
  return new RequestError(spec.code, spec.message);
}

const DEFAULT_OPTIONS = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

let sessionCounter = 0;
/** sessionId -> mcpServers from session/new or session/load */
const sessions = new Map();
/** sessionId -> resolve fn for the in-flight prompt's cancel waiter */
const cancelWaiters = new Map();
const cancelled = new Set();
let lastClient;

/** Call `report_status` on a stdio MCP server using minimal JSON lines. */
function reportStatus(server, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const { name, value } of server.env ?? []) env[name] = value;
    const child = spawn(server.command, server.args, {
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    child.on('error', reject);
    const send = (msg) =>
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id === 1) {
        send({ method: 'notifications/initialized' });
        send({
          id: 2,
          method: 'tools/call',
          params: { name: 'report_status', arguments: args },
        });
      } else if (msg.id === 2) {
        rl.close();
        child.stdin.end();
        child.kill();
        resolve(msg.result);
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'fake-acp-agent', version: '0.0.0' },
      },
    });
  });
}

function update(client, sessionId, payload) {
  return client.notify(methods.client.session.update, {
    sessionId,
    update: payload,
  });
}

function toolOutput(text) {
  return [{ type: 'content', content: { type: 'text', text } }];
}

async function runTool(client, sessionId, step) {
  const locations = (step.locations ?? []).map((loc) =>
    typeof loc === 'string' ? { path: loc } : loc,
  );
  const toolCall = {
    toolCallId: step.id,
    title: step.title,
    kind: step.kind,
    status: 'pending',
    ...(step.rawInput !== undefined ? { rawInput: step.rawInput } : {}),
    ...(locations.length ? { locations } : {}),
  };
  await update(client, sessionId, { sessionUpdate: 'tool_call', ...toolCall });

  let allowed = true;
  if (step.askPermission) {
    const options = step.options ?? DEFAULT_OPTIONS;
    const response = await client.request(
      methods.client.session.requestPermission,
      { sessionId, toolCall, options },
    );
    record({ permissionResponse: response, toolCallId: step.id });
    const outcome = response?.outcome;
    const chosen =
      outcome?.outcome === 'selected'
        ? options.find((o) => o.optionId === outcome.optionId)
        : undefined;
    allowed = Boolean(chosen && String(chosen.kind).startsWith('allow'));
  }

  await update(client, sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId: step.id,
    status: allowed ? 'completed' : 'failed',
    content: toolOutput(allowed ? String(step.output ?? '') : 'denied'),
  });
}

function crash(code) {
  process.stderr.write(`fake-acp-agent: crashing with code ${code}\n`, () =>
    process.exit(code),
  );
}

const app = agent({ name: 'fake' })
  .onRequest(methods.agent.initialize, ({ params }) => {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: scenario.agentCapabilities ?? {},
      authMethods: scenario.authMethods ?? [],
    };
  })
  .onRequest(methods.agent.session.new, ({ params }) => {
    if (scenario.newSessionError) throw rpcError(scenario.newSessionError);
    const sessionId = `fake-session-${++sessionCounter}`;
    sessions.set(sessionId, params.mcpServers ?? []);
    return {
      sessionId,
      ...(scenario.modes ? { modes: scenario.modes } : {}),
    };
  })
  .onRequest(methods.agent.session.load, async ({ params, client }) => {
    if (scenario.loadError) throw rpcError(scenario.loadError);
    sessions.set(params.sessionId, params.mcpServers ?? []);
    if (scenario.loadReplay) {
      await update(client, params.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: scenario.loadReplay },
      });
    }
    return scenario.modes ? { modes: scenario.modes } : {};
  })
  .onRequest(methods.agent.session.resume, ({ params }) => {
    if (scenario.resumeError) throw rpcError(scenario.resumeError);
    sessions.set(params.sessionId, params.mcpServers ?? []);
    return scenario.modes ? { modes: scenario.modes } : {};
  })
  .onRequest(methods.agent.session.setMode, ({ params }) => {
    return {};
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    lastClient = client;
    const { sessionId } = params;
    const cancelPromise = new Promise((resolve) =>
      cancelWaiters.set(sessionId, resolve),
    );
    for (const step of steps) {
      if (cancelled.has(sessionId)) break;
      if (step.type === 'message') {
        await update(client, sessionId, {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: step.text },
        });
      } else if (step.type === 'tool') {
        await runTool(client, sessionId, step);
      } else if (step.type === 'reportStatus') {
        const server = (sessions.get(sessionId) ?? []).find(
          (s) => s.name === 'artificer-status',
        );
        if (!server) throw new Error('artificer-status MCP server missing');
        await reportStatus(server, {
          status: step.status,
          summary: step.summary,
        });
      } else if (step.type === 'hang') {
        if (scenario.ignoreCancel) await new Promise(() => {});
        await cancelPromise;
      } else if (step.type === 'crash') {
        crash(step.code ?? 1);
        await new Promise(() => {});
      }
    }
    cancelWaiters.delete(sessionId);
    if (cancelled.has(sessionId)) return { stopReason: 'cancelled' };
    return { stopReason: scenario.stopReason ?? 'end_turn' };
  })
  .onNotification(methods.agent.session.cancel, async ({ params }) => {
    if (scenario.ignoreCancel) return;
    if (scenario.askPermissionAfterCancel && lastClient) {
      const toolCall = {
        toolCallId: 'after-cancel',
        title: 'after cancel',
        kind: 'execute',
        status: 'pending',
      };
      try {
        const response = await lastClient.request(
          methods.client.session.requestPermission,
          { sessionId: params.sessionId, toolCall, options: DEFAULT_OPTIONS },
        );
        record({ permissionResponse: response, toolCallId: 'after-cancel' });
      } catch (err) {
        record({ permissionError: String(err), toolCallId: 'after-cancel' });
      }
    }
    cancelled.add(params.sessionId);
    cancelWaiters.get(params.sessionId)?.();
  });

if (scenario.preStdout) process.stdout.write(scenario.preStdout);

/**
 * Record requests as they arrive on the wire, before the SDK's schema parsing
 * fills in defaults, so tests see exactly what the client sent.
 */
function recordIncoming() {
  const decoder = new TextDecoder();
  let pending = '';
  const recordLine = (line) => {
    try {
      const msg = JSON.parse(line);
      if (typeof msg.method === 'string') {
        record({ method: msg.method, params: msg.params });
      }
    } catch {
      /* not JSON; the SDK reports it */
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) recordLine(line);
      controller.enqueue(chunk);
    },
  });
}

const connection = app.connect(
  ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin).pipeThrough(recordIncoming()),
  ),
);
connection.closed.then(() => process.exit(0));
