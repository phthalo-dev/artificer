import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { emptyUsage, type RunRecord } from '../storage/types.js';
import { shellApprovalKey } from '../tools/tool-policy.js';
import { AcpExecutor } from './acp-executor.js';
import { decidePermission } from './acp-permissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, '__fixtures__', 'fake-acp-agent.mjs');
const FIXTURE = path.join(
  here,
  '__fixtures__',
  'opencode-2.0.32-permission-requests.json',
);

/** Real temp workspace (realpath: macOS /var -> /private/var). */
async function workspace(): Promise<{ ws: string; parent: string }> {
  const parent = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-oc-')),
  );
  const ws = path.join(parent, 'ws');
  await fs.mkdir(ws);
  return { ws, parent };
}

async function loadRequests(
  ws: string,
  parent: string,
): Promise<RequestPermissionRequest[]> {
  const raw = await fs.readFile(FIXTURE, 'utf-8');
  return JSON.parse(
    raw.replaceAll('{{WS}}', ws).replaceAll('{{PARENT}}', parent),
  );
}

function decide(req: RequestPermissionRequest, ws: string) {
  return decidePermission(req, {
    role: 'worker',
    workspaceDir: ws,
    policy: { rules: [] } as never,
    cancelling: false,
  });
}

function optionId(o: ReturnType<typeof decide>): string | undefined {
  return o.response.outcome.outcome === 'selected'
    ? o.response.outcome.optionId
    : undefined;
}

test('recorded OpenCode requests map onto Artificer policy', async (t) => {
  const { ws, parent } = await workspace();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const [ls, inside, outside, rm] = await loadRequests(ws, parent);

  const a = decide(ls!, ws);
  assert.equal(a.decision, 'allow');
  assert.equal(optionId(a), 'once');

  const b = decide(inside!, ws);
  assert.equal(b.decision, 'allow');
  assert.equal(optionId(b), 'once');

  const c = decide(outside!, ws);
  assert.equal(c.decision, 'deny');
  assert.equal(optionId(c), 'reject');
  assert.ok(c.reason);

  const d = decide(rm!, ws);
  assert.equal(d.decision, 'deny');
  assert.equal(optionId(d), 'reject');
  assert.equal(d.proposedRule?.pattern, shellApprovalKey('rm -rf build'));
});

test('rejected permission ending the turn still resolves', async (t) => {
  const { ws, parent } = await workspace();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-oc-sc-'));
  t.after(async () => {
    await fs.rm(parent, { recursive: true, force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });
  const rm = (await loadRequests(ws, parent))[3]!;
  const scenarioPath = path.join(dir, 'scenario.json');
  await fs.writeFile(
    scenarioPath,
    JSON.stringify({
      recordFile: path.join(dir, 'record.jsonl'),
      stopAfterPermissionReject: true,
      steps: [
        { type: 'message', text: 'trying' },
        {
          type: 'tool',
          id: rm.toolCall.toolCallId,
          title: rm.toolCall.title,
          kind: rm.toolCall.kind,
          rawInput: rm.toolCall.rawInput,
          askPermission: true,
          options: rm.options,
          permissionToolCall: rm.toolCall,
        },
        { type: 'message', text: 'never sent' },
      ],
    }),
  );
  const run: RunRecord = {
    id: 'run-1',
    role: 'worker',
    task: 't',
    status: 'running',
    toolCalls: [],
    usage: emptyUsage(),
    createdAt: new Date().toISOString(),
  };
  const executor = new AcpExecutor(
    { type: 'acp', command: process.execPath, args: [FAKE, scenarioPath] },
    { stateDir: path.join(path.dirname(scenarioPath), 'acp') },
  );
  const result = await executor.execute({
    context: 'do the thing',
    workspaceDir: ws,
    run,
  });
  assert.ok(result.text.endsWith('[agent stopped: cancelled]'), result.text);
  assert.ok(!result.text.includes('never sent'));
});
