import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import type { ToolContext } from '../context.js';
import type { ScheduleDefinition } from '../engine/schedules.js';
import { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';
import { createScheduleTools } from './schedules.js';

async function freshContext(): Promise<{
  ctx: ToolContext;
  schedules: Map<string, ScheduleDefinition>;
  reloads: { count: number };
}> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-schedule-tools-'),
  );
  const store = new Store(dir);
  await store.init();
  const run = await store.createRun({ role: 'communicator', task: 'schedule' });
  const schedules = new Map<string, ScheduleDefinition>();
  const reloads = { count: 0 };
  const engine = {
    store,
    listSchedules: () =>
      [...schedules.values()].map((schedule) => ({
        ...schedule,
        lastFiredAt: schedule.id === 'daily' ? 123 : null,
        inFlight: schedule.id === 'daily',
      })),
    async upsertSchedule(input: Omit<ScheduleDefinition, 'sourcePath'>) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(input.id)) {
        return { ok: false as const, error: 'id must be a safe schedule ID' };
      }
      schedules.set(input.id, {
        ...input,
        sourcePath: `/schedules/${input.id}.md`,
      });
      reloads.count += 1;
      return { ok: true as const };
    },
    async setScheduleEnabled(id: string, enabled: boolean) {
      const schedule = schedules.get(id);
      if (!schedule)
        return { ok: false as const, error: `schedule "${id}" not found` };
      schedules.set(id, { ...schedule, enabled });
      reloads.count += 1;
      return { ok: true as const };
    },
    async deleteSchedule(id: string) {
      if (!schedules.delete(id))
        return { ok: false as const, error: `schedule "${id}" not found` };
      const state = await store.readScheduleState();
      delete state.schedules[id];
      await store.writeScheduleState(state);
      reloads.count += 1;
      return { ok: true as const };
    },
  };
  return {
    ctx: {
      engine: engine as unknown as ToolContext['engine'],
      run,
      workspaceDir: dir,
    },
    schedules,
    reloads,
  };
}

function tool(ctx: ToolContext, name: string) {
  const result = createScheduleTools(ctx).find(
    (candidate) => candidate.name === name,
  );
  assert.ok(result, `${name} is present`);
  return result;
}

test('upsert_schedule writes a schedule and reloads', async () => {
  const { ctx, schedules, reloads } = await freshContext();
  const result = await tool(ctx, 'upsert_schedule').handler({
    id: 'daily',
    every: '1d',
    action: 'communicator',
    body: 'Send the daily summary.',
  });
  assert.match(result, /updated/i);
  assert.equal(schedules.get('daily')?.body, 'Send the daily summary.');
  assert.equal(reloads.count, 1);
});

test('upsert_schedule rejects unsafe ids', async () => {
  const { ctx } = await freshContext();
  const result = await tool(ctx, 'upsert_schedule').handler({
    id: '../unsafe',
    every: '1d',
    action: 'communicator',
    body: 'Nope',
  });
  assert.match(result, /safe schedule ID/i);
});

test('set_schedule_enabled flips a schedule', async () => {
  const { ctx, schedules } = await freshContext();
  schedules.set('daily', {
    id: 'daily',
    name: 'daily',
    everyMs: 86_400_000,
    timezone: 'UTC',
    action: 'communicator',
    enabled: true,
    body: 'Summary',
    sourcePath: '/schedules/daily.md',
  });
  const result = await tool(ctx, 'set_schedule_enabled').handler({
    id: 'daily',
    enabled: false,
  });
  assert.match(result, /disabled/i);
  assert.equal(schedules.get('daily')?.enabled, false);
});

test('delete_schedule removes state', async () => {
  const { ctx, schedules } = await freshContext();
  schedules.set('daily', {
    id: 'daily',
    name: 'daily',
    everyMs: 86_400_000,
    timezone: 'UTC',
    action: 'communicator',
    enabled: true,
    body: 'Summary',
    sourcePath: '/schedules/daily.md',
  });
  await ctx.engine.store.writeScheduleState({
    schedules: { daily: { lastFiredAt: 1 } },
  });
  const result = await tool(ctx, 'delete_schedule').handler({ id: 'daily' });
  assert.match(result, /deleted/i);
  assert.equal(schedules.has('daily'), false);
  assert.deepEqual((await ctx.engine.store.readScheduleState()).schedules, {});
});

test('list_schedules includes lastFired and inFlight', async () => {
  const { ctx, schedules } = await freshContext();
  schedules.set('daily', {
    id: 'daily',
    name: 'daily',
    everyMs: 86_400_000,
    timezone: 'UTC',
    action: 'communicator',
    enabled: true,
    body: 'Summary',
    sourcePath: '/schedules/daily.md',
  });
  const result = await tool(ctx, 'list_schedules').handler({});
  assert.deepEqual(JSON.parse(result), [
    {
      id: 'daily',
      name: 'daily',
      everyMs: 86_400_000,
      timezone: 'UTC',
      action: 'communicator',
      enabled: true,
      body: 'Summary',
      sourcePath: '/schedules/daily.md',
      lastFiredAt: 123,
      inFlight: true,
    },
  ]);
});
