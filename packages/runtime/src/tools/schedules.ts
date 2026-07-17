import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

/** Tools for the communicator to create and manage the agent's schedules. */
export function createScheduleTools(ctx: ToolContext): ToolDef[] {
  const { engine } = ctx;

  return [
    {
      name: 'list_schedules',
      description:
        'List configured schedules, including whether each is currently running and when it last fired.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => JSON.stringify(engine.listSchedules(), null, 2),
    },
    {
      name: 'upsert_schedule',
      description:
        'Create or replace a schedule. Supply exactly one of every (such as "15m") or cron (five fields).',
      inputSchema: {
        type: 'object',
        required: ['id', 'action', 'body'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          every: { type: 'string' },
          cron: { type: 'string' },
          timezone: { type: 'string' },
          action: { type: 'string', enum: ['communicator', 'workstream'] },
          enabled: { type: 'boolean' },
          body: { type: 'string' },
        },
      },
      handler: async (input) => {
        const result = await engine.upsertSchedule({
          id: String(input.id ?? ''),
          name: input.name === undefined ? undefined : String(input.name),
          every: input.every === undefined ? undefined : String(input.every),
          cron: input.cron === undefined ? undefined : String(input.cron),
          timezone:
            input.timezone === undefined ? undefined : String(input.timezone),
          action: input.action as 'communicator' | 'workstream',
          enabled:
            input.enabled === undefined ? undefined : Boolean(input.enabled),
          body: String(input.body ?? ''),
        });
        return result.ok
          ? `Schedule "${input.id}" updated.`
          : `Error: ${result.error}`;
      },
    },
    {
      name: 'set_schedule_enabled',
      description:
        'Enable or disable a schedule without changing its timing or action.',
      inputSchema: {
        type: 'object',
        required: ['id', 'enabled'],
        properties: { id: { type: 'string' }, enabled: { type: 'boolean' } },
      },
      handler: async (input) => {
        const result = await engine.setScheduleEnabled(
          String(input.id ?? ''),
          Boolean(input.enabled),
        );
        if (!result.ok) return `Error: ${result.error}`;
        return `Schedule "${input.id}" ${input.enabled ? 'enabled' : 'disabled'}.`;
      },
    },
    {
      name: 'delete_schedule',
      description:
        'Permanently delete a schedule and its recorded last-fired state.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      handler: async (input) => {
        const result = await engine.deleteSchedule(String(input.id ?? ''));
        return result.ok
          ? `Schedule "${input.id}" deleted.`
          : `Error: ${result.error}`;
      },
    },
  ];
}
