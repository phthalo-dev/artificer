import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cronMatchesMinute,
  isSafeScheduleId,
  isScheduleDue,
  type ScheduleDefinition,
} from './schedules.js';

function everySchedule(
  overrides: Partial<ScheduleDefinition> = {},
): ScheduleDefinition {
  return {
    id: 'every',
    name: 'Every schedule',
    everyMs: 60_000,
    timezone: 'UTC',
    action: 'communicator',
    enabled: true,
    body: 'hi',
    sourcePath: '/tmp/every.md',
    ...overrides,
  };
}

describe('isSafeScheduleId', () => {
  it('rejects path traversal and accepts safe IDs', () => {
    assert.equal(isSafeScheduleId('../x'), false);
    assert.equal(isSafeScheduleId('morning-check'), true);
  });
});

describe('isScheduleDue', () => {
  it('waits one full interval after starting before an unfired every schedule is due', () => {
    const schedule = everySchedule();
    const startedAtMs = 1_000_000;

    assert.equal(
      isScheduleDue({
        schedule,
        nowMs: startedAtMs + 30_000,
        lastFiredAt: null,
        startedAtMs,
      }),
      false,
    );
    assert.equal(
      isScheduleDue({
        schedule,
        nowMs: startedAtMs + 60_000,
        lastFiredAt: null,
        startedAtMs,
      }),
      true,
    );
  });

  it('uses the last firing time to evaluate every schedules', () => {
    const schedule = everySchedule();

    assert.equal(
      isScheduleDue({
        schedule,
        nowMs: 200_000,
        lastFiredAt: 100_000,
        startedAtMs: 0,
      }),
      true,
    );
    assert.equal(
      isScheduleDue({
        schedule,
        nowMs: 150_000,
        lastFiredAt: 100_000,
        startedAtMs: 0,
      }),
      false,
    );
  });

  it('fires a cron schedule at most once in a matching minute', () => {
    const schedule = everySchedule({
      id: 'cron',
      cron: '0 9 * * 1',
      everyMs: undefined,
      timezone: 'America/Los_Angeles',
      action: 'workstream',
    });
    const nowMs = Date.parse('2026-07-13T16:00:30.000Z');

    assert.equal(
      isScheduleDue({ schedule, nowMs, lastFiredAt: null, startedAtMs: 0 }),
      true,
    );
    assert.equal(
      isScheduleDue({
        schedule,
        nowMs,
        lastFiredAt: Date.parse('2026-07-13T16:00:05.000Z'),
        startedAtMs: 0,
      }),
      false,
    );
  });

  it('never fires disabled schedules', () => {
    assert.equal(
      isScheduleDue({
        schedule: everySchedule({ enabled: false, everyMs: 1 }),
        nowMs: 999_999,
        lastFiredAt: null,
        startedAtMs: 0,
      }),
      false,
    );
  });
});

describe('cronMatchesMinute', () => {
  it('matches weekday wall-clock time in the requested timezone', () => {
    const date = new Date('2026-07-13T16:00:00.000Z');

    assert.equal(
      cronMatchesMinute('0 9 * * 1', date, 'America/Los_Angeles'),
      true,
    );
    assert.equal(cronMatchesMinute('0 9 * * 1', date, 'UTC'), false);
  });

  it('supports ranges, steps, comma lists, and standard cron weekdays', () => {
    const date = new Date('2026-07-13T16:15:00.000Z');

    assert.equal(
      cronMatchesMinute('*/15 8-10 1,13 * 1,3', date, 'America/Los_Angeles'),
      true,
    );
  });

  it('rejects invalid cron fields', () => {
    const date = new Date('2026-07-13T16:00:00.000Z');

    assert.equal(cronMatchesMinute('60 9 * * 1', date, 'UTC'), false);
    assert.equal(cronMatchesMinute('*,invalid * * * *', date, 'UTC'), false);
    assert.equal(cronMatchesMinute('* * *', date, 'UTC'), false);
  });
});
