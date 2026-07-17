import { parseDuration } from '../config.js';

export type ScheduleAction = 'communicator' | 'workstream';

export interface ScheduleRuntimeState {
  schedules: Record<string, { lastFiredAt: number }>;
}

export function emptyScheduleRuntimeState(): ScheduleRuntimeState {
  return { schedules: {} };
}

export interface ScheduleDefinition {
  id: string;
  name: string;
  everyMs?: number;
  cron?: string;
  timezone: string;
  action: ScheduleAction;
  enabled: boolean;
  body: string;
  sourcePath: string;
}

export interface ScheduleFields {
  id: string;
  name?: string;
  every?: string;
  cron?: string;
  timezone?: string;
  action?: string;
  enabled?: string | boolean;
  body: string;
  sourcePath: string;
}

export function serializeSchedule(definition: ScheduleDefinition): string {
  const lines = [
    `name: ${definition.name}`,
    ...(definition.everyMs === undefined ? [] : [`every: ${definition.everyMs}ms`]),
    ...(definition.cron === undefined ? [] : [`cron: ${definition.cron}`]),
    `timezone: ${definition.timezone}`,
    `action: ${definition.action}`,
    `enabled: ${definition.enabled}`,
  ];
  return `---\n${lines.join('\n')}\n---\n\n${definition.body}\n`;
}

export function isSafeScheduleId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);
}

export function parseCronExpression(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 ? parts.join(' ') : null;
}

const CRON_FIELD_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
] as const;

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (!field) {
    return false;
  }

  let matches = false;
  for (const part of field.split(',')) {
    if (part === '*') {
      matches = true;
      continue;
    }

    const stepMatch = /^\*\/(\d+)$/.exec(part);
    if (stepMatch) {
      const step = Number(stepMatch[1]);
      if (step < 1 || step > max - min + 1) {
        return false;
      }
      matches ||= (value - min) % step === 0;
      continue;
    }

    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < min || end > max || start > end) {
        return false;
      }
      matches ||= value >= start && value <= end;
      continue;
    }

    if (!/^\d+$/.test(part)) {
      return false;
    }

    const number = Number(part);
    if (number < min || number > max) {
      return false;
    }
    matches ||= value === number;
  }

  return matches;
}

export function cronMatchesMinute(cron: string, date: Date, timeZone: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5 || Number.isNaN(date.getTime())) {
    return false;
  }

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      minute: '2-digit',
      hour: '2-digit',
      day: '2-digit',
      month: '2-digit',
      weekday: 'short',
    }).formatToParts(date);
  } catch {
    return false;
  }

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const weekday = WEEKDAYS[values.weekday];
  const cronValues = [
    Number(values.minute),
    Number(values.hour),
    Number(values.day),
    Number(values.month),
    weekday,
  ];

  return cronValues.every(
    (value, index) =>
      Number.isInteger(value) &&
      cronFieldMatches(
        fields[index],
        value,
        CRON_FIELD_RANGES[index][0],
        CRON_FIELD_RANGES[index][1],
      ),
  );
}

export function isScheduleDue({
  schedule,
  nowMs,
  lastFiredAt,
  startedAtMs,
}: {
  schedule: ScheduleDefinition;
  nowMs: number;
  lastFiredAt: number | null;
  startedAtMs: number;
}): boolean {
  if (!schedule.enabled) {
    return false;
  }

  if (schedule.everyMs !== undefined) {
    const dueAt = (lastFiredAt ?? startedAtMs) + schedule.everyMs;
    return nowMs >= dueAt;
  }

  if (!schedule.cron || !cronMatchesMinute(schedule.cron, new Date(nowMs), schedule.timezone)) {
    return false;
  }

  return lastFiredAt === null || Math.floor(lastFiredAt / 60_000) !== Math.floor(nowMs / 60_000);
}

export function validateScheduleFields(
  input: ScheduleFields,
): { ok: true; value: ScheduleDefinition } | { ok: false; error: string } {
  if (!isSafeScheduleId(input.id)) {
    return { ok: false, error: 'id must be a safe schedule ID' };
  }

  const every = input.every?.trim();
  const cron = input.cron?.trim();
  if (Boolean(every) === Boolean(cron)) {
    return { ok: false, error: 'exactly one of every or cron is required' };
  }

  let everyMs: number | undefined;
  let normalizedCron: string | undefined;
  if (every) {
    everyMs = parseDuration(every);
    if (everyMs === undefined) {
      return { ok: false, error: 'every must be a valid duration' };
    }
  } else if (cron) {
    normalizedCron = parseCronExpression(cron) ?? undefined;
    if (!normalizedCron) {
      return { ok: false, error: 'cron must contain exactly five fields' };
    }
  }

  if (input.action !== 'communicator' && input.action !== 'workstream') {
    return { ok: false, error: 'action must be communicator or workstream' };
  }

  let enabled: boolean;
  if (input.enabled === undefined) {
    enabled = true;
  } else if (input.enabled === true || input.enabled === 'true') {
    enabled = true;
  } else if (input.enabled === false || input.enabled === 'false') {
    enabled = false;
  } else {
    return { ok: false, error: 'enabled must be true or false' };
  }

  const body = input.body.trim();
  if (!body) {
    return { ok: false, error: 'body is required' };
  }

  for (const [field, value] of Object.entries({
    name: input.name,
    timezone: input.timezone,
  })) {
    if (value?.includes('\n') || value?.includes('\r')) {
      return { ok: false, error: `${field} must not contain a newline` };
    }
  }

  return {
    ok: true,
    value: {
      id: input.id,
      name: input.name?.trim() || input.id,
      ...(everyMs === undefined ? {} : { everyMs }),
      ...(normalizedCron === undefined ? {} : { cron: normalizedCron }),
      timezone: input.timezone?.trim() || 'UTC',
      action: input.action,
      enabled,
      body,
      sourcePath: input.sourcePath,
    },
  };
}
