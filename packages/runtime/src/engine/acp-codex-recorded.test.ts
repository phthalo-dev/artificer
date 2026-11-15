import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type {
  RequestPermissionRequest,
  SessionNotification,
  ToolCall,
} from '@agentclientprotocol/sdk';
import { shellApprovalKey } from '../tools/tool-policy.js';
import { decidePermission, fillPermissionRequest } from './acp-permissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  here,
  '__fixtures__',
  'codex-acp-2.6.0-recorded.json',
);

interface CodexFixture {
  execPermissionRequests: RequestPermissionRequest[];
  mcpToolCallUpdate: SessionNotification;
  mcpPermissionRequest: RequestPermissionRequest;
}

/** Real temp workspace (realpath: macOS /var -> /private/var). */
async function workspace(): Promise<{ ws: string; parent: string }> {
  const parent = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-codex-')),
  );
  const ws = path.join(parent, 'ws');
  await fs.mkdir(ws);
  return { ws, parent };
}

async function loadFixture(ws: string, parent: string): Promise<CodexFixture> {
  const raw = await fs.readFile(FIXTURE, 'utf-8');
  return JSON.parse(
    raw
      .replaceAll('{{WS}}', ws)
      .replaceAll('{{PARENT}}', parent)
      .replaceAll('{{HOME}}', os.homedir()),
  );
}

function decide(req: RequestPermissionRequest, ws: string) {
  return decidePermission(req, {
    role: 'worker',
    workspaceDir: ws,
    policy: { version: 1, rules: [] },
    cancelling: false,
  });
}

function optionId(o: ReturnType<typeof decide>): string | undefined {
  return o.response.outcome.outcome === 'selected'
    ? o.response.outcome.optionId
    : undefined;
}

test('recorded Codex exec requests map onto Artificer policy', async (t) => {
  const { ws, parent } = await workspace();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const [write, rm] = (await loadFixture(ws, parent)).execPermissionRequests;

  const a = decide(write!, ws);
  assert.equal(a.decision, 'allow');
  assert.equal(a.tool, 'run_shell');
  assert.equal(optionId(a), 'allow_once');

  const b = decide(rm!, ws);
  assert.equal(b.decision, 'deny');
  assert.equal(optionId(b), 'cancel');
  assert.equal(b.proposedRule?.pattern, shellApprovalKey('rm -rf build'));
});

test('recorded Codex MCP approval is allowed after fill-in', async (t) => {
  const { ws, parent } = await workspace();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const fixture = await loadFixture(ws, parent);
  const tracked = fixture.mcpToolCallUpdate.update as ToolCall & {
    sessionUpdate: 'tool_call';
  };
  assert.equal(
    tracked.toolCallId,
    fixture.mcpPermissionRequest.toolCall.toolCallId,
  );

  // Without fill-in the detail-free request must not be allowed.
  const bare = decide(fixture.mcpPermissionRequest, ws);
  assert.equal(bare.decision, 'deny');

  const o = decide(
    fillPermissionRequest(fixture.mcpPermissionRequest, tracked),
    ws,
  );
  assert.equal(o.decision, 'allow');
  assert.equal(o.tool, 'mcp:artificer-status.report_status');
  assert.equal(optionId(o), 'allow_once');
});
