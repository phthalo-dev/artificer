import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ToolContext } from '../context.js';
import { Store } from '../storage/store.js';
import { createServiceTools } from './services.js';

interface FakeCall {
  method: string;
  args: unknown[];
}

async function freshContext(
  workstreamId?: string,
): Promise<{ ctx: ToolContext; calls: FakeCall[] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-svc-tools-'));
  const store = new Store(dir);
  await store.init();
  const run = await store.createRun({ role: 'worker', task: 'test' });
  run.workstreamId = workstreamId;
  const calls: FakeCall[] = [];
  const engine = {
    store,
    async startService(workstreamId: string, name: string) {
      calls.push({ method: 'startService', args: [workstreamId, name] });
      return {
        status: 'started' as const,
        port: 4100,
        url: 'http://127.0.0.1:4100',
      };
    },
    async stopService(workstreamId: string, name: string) {
      calls.push({ method: 'stopService', args: [workstreamId, name] });
      return { status: 'stopped' as const };
    },
    async listServices(workstreamId: string) {
      calls.push({ method: 'listServices', args: [workstreamId] });
      return [{ name: 'web', port: 4100, status: 'running' as const }];
    },
    async checkService(workstreamId: string, name: string) {
      calls.push({ method: 'checkService', args: [workstreamId, name] });
      return { status: 200, body: 'ok' };
    },
  } as unknown as ToolContext['engine'];
  return { ctx: { engine, run, workspaceDir: dir }, calls };
}

test('start_service calls engine.startService with the run workstreamId', async () => {
  const { ctx, calls } = await freshContext('ws1');
  const tools = createServiceTools(ctx);
  const startTool = tools.find((t) => t.name === 'start_service')!;
  const result = await startTool.handler({ name: 'web' });
  assert.deepEqual(JSON.parse(result), {
    status: 'started',
    port: 4100,
    url: 'http://127.0.0.1:4100',
  });
  assert.deepEqual(calls, [{ method: 'startService', args: ['ws1', 'web'] }]);
});

test('stop_service, list_services, check_service delegate to engine', async () => {
  const { ctx } = await freshContext('ws1');
  const tools = createServiceTools(ctx);
  const stopResult = await tools
    .find((t) => t.name === 'stop_service')!
    .handler({
      name: 'web',
    });
  assert.deepEqual(JSON.parse(stopResult), { status: 'stopped' });

  const listResult = await tools
    .find((t) => t.name === 'list_services')!
    .handler({});
  assert.deepEqual(JSON.parse(listResult), [
    { name: 'web', port: 4100, status: 'running' },
  ]);

  const checkResult = await tools
    .find((t) => t.name === 'check_service')!
    .handler({ name: 'web' });
  assert.deepEqual(JSON.parse(checkResult), { status: 200, body: 'ok' });
});

test('start_service throws when the run has no workstreamId', async () => {
  const { ctx } = await freshContext(undefined);
  const tools = createServiceTools(ctx);
  const startTool = tools.find((t) => t.name === 'start_service')!;
  await assert.rejects(
    () => startTool.handler({ name: 'web' }),
    /Service tools require a workstream-scoped run/,
  );
});
