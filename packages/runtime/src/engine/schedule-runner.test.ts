import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ScheduleRunner } from './schedule-runner.js';
import type { ScheduleRuntimeState } from './schedules.js';

describe('ScheduleRunner', () => {
  it('fires communicator when every interval elapses', async () => {
    let now = 0;
    let state: ScheduleRuntimeState = { schedules: {} };
    const messages: string[] = [];
    const runner = new ScheduleRunner({
      nowMs: () => now,
      pollIntervalMs: 1_000_000,
      receiveMessage: async (content) => {
        messages.push(content);
        return { messageId: 'm1' };
      },
      createWorkstream: async () => ({ workstreamId: 'w1' }),
      readState: async () => state,
      writeState: async (nextState) => {
        state = nextState;
      },
      isCommunicatorRunTerminal: async () => true,
      isWorkstreamTerminal: async () => true,
    });
    runner.reload([
      {
        id: 'hb',
        name: 'HB',
        everyMs: 1_000,
        timezone: 'UTC',
        action: 'communicator',
        enabled: true,
        body: 'Wake up',
        sourcePath: '/tmp/hb.md',
      },
    ]);

    now = 999;
    await runner.tick();
    assert.equal(messages.length, 0);

    now = 1_000;
    await runner.tick();
    assert.equal(messages.length, 1);
    assert.match(messages[0], /\[schedule:hb\]/);
    assert.match(messages[0], /Wake up/);
    assert.equal(state.schedules.hb.lastFiredAt, 1_000);
  });

  it('skips when the previous communicator fire remains in flight', async () => {
    let now = 1_000;
    let state: ScheduleRuntimeState = { schedules: {} };
    let messageCount = 0;
    const runner = new ScheduleRunner({
      nowMs: () => now,
      receiveMessage: async () => {
        messageCount += 1;
        return { messageId: 'm1' };
      },
      createWorkstream: async () => ({ workstreamId: 'w1' }),
      readState: async () => state,
      writeState: async (nextState) => {
        state = nextState;
      },
      isCommunicatorRunTerminal: async () => false,
      isWorkstreamTerminal: async () => true,
    });
    runner.reload([
      {
        id: 'hb',
        name: 'HB',
        everyMs: 1_000,
        timezone: 'UTC',
        action: 'communicator',
        enabled: true,
        body: 'Wake up',
        sourcePath: '/tmp/hb.md',
      },
    ]);

    await runner.tick();
    now = 2_000;
    await runner.tick();

    assert.equal(messageCount, 1);
    assert.equal(runner.list()[0].inFlight, true);
  });

  it('fires workstream actions with the schedule name and body', async () => {
    let now = 0;
    let state: ScheduleRuntimeState = { schedules: {} };
    const workstreams: Array<{ title: string; goal: string }> = [];
    const runner = new ScheduleRunner({
      nowMs: () => now,
      receiveMessage: async () => ({ messageId: 'm1' }),
      createWorkstream: async (input) => {
        workstreams.push(input);
        return { workstreamId: 'w1' };
      },
      readState: async () => state,
      writeState: async (nextState) => {
        state = nextState;
      },
      isWorkstreamTerminal: async () => true,
    });
    runner.reload([
      {
        id: 'daily-review',
        name: 'Daily review',
        everyMs: 1_000,
        timezone: 'UTC',
        action: 'workstream',
        enabled: true,
        body: 'Review yesterday and plan today',
        sourcePath: '/tmp/review.md',
      },
    ]);

    now = 1_000;
    await runner.tick();

    assert.deepEqual(workstreams, [
      { title: 'Daily review', goal: 'Review yesterday and plan today' },
    ]);
    assert.equal(state.schedules['daily-review'].lastFiredAt, 1_000);
  });

  it('reverts the stamp when a fire rejects before accepting', async () => {
    let now = 1_000;
    let state: ScheduleRuntimeState = { schedules: {} };
    const runner = new ScheduleRunner({
      nowMs: () => now,
      receiveMessage: async () => {
        throw new Error('unavailable');
      },
      createWorkstream: async () => ({ workstreamId: 'w1' }),
      readState: async () => state,
      writeState: async (nextState) => {
        state = nextState;
      },
    });
    runner.reload([
      {
        id: 'hb',
        name: 'HB',
        everyMs: 1_000,
        timezone: 'UTC',
        action: 'communicator',
        enabled: true,
        body: 'Wake up',
        sourcePath: '/tmp/hb.md',
      },
    ]);

    await runner.tick();

    assert.equal(state.schedules.hb, undefined);
    assert.equal(runner.list()[0].inFlight, false);
  });

  it('clears state when deletion is queued behind an in-flight tick', async () => {
    let now = 0;
    let state: ScheduleRuntimeState = { schedules: {} };
    let releaseRead: (() => void) | undefined;
    let reading: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const readCanFinish = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const messages: string[] = [];
    const runner = new ScheduleRunner({
      nowMs: () => now,
      receiveMessage: async (content) => {
        messages.push(content);
        return { messageId: 'm1' };
      },
      createWorkstream: async () => ({ workstreamId: 'w1' }),
      readState: async () => {
        reading?.();
        await readCanFinish;
        return state;
      },
      writeState: async (nextState) => {
        state = nextState;
      },
    });
    await runner.reload([
      {
        id: 'hb',
        name: 'HB',
        everyMs: 1_000,
        timezone: 'UTC',
        action: 'communicator',
        enabled: true,
        body: 'Wake up',
        sourcePath: '/tmp/hb.md',
      },
    ]);

    now = 1_000;
    const tick = runner.tick();
    await readStarted;
    const remove = runner.remove('hb');
    releaseRead?.();
    await Promise.all([tick, remove]);

    assert.equal(messages.length, 1);
    assert.equal(state.schedules.hb, undefined);
    assert.deepEqual(runner.list(), []);
  });
});
