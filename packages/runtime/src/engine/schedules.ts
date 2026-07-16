import { parseDuration } from '../config.js';

export type ScheduleAction = 'communicator' | 'workstream';

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

export function isSafeScheduleId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);
}

export function parseCronExpression(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 ? parts.join(' ') : null;
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
