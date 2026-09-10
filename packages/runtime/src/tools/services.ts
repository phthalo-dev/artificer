import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';

function requireWorkstreamId(ctx: ToolContext): string {
  const id = ctx.run.workstreamId;
  if (!id) {
    throw new Error('Service tools require a workstream-scoped run.');
  }
  return id;
}

/** Tools for the worker/reviewer roles to run and check a project's declared dev-server services. */
export function createServiceTools(ctx: ToolContext): ToolDef[] {
  const { engine } = ctx;

  return [
    {
      name: 'start_service',
      description:
        'Start a named dev-server/service declared in .artificer/workspace.json and leave it running in the background. Returns its allocated port and URL. Safe to call again for an already-running service.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            description: 'The service name from .artificer/workspace.json.',
          },
        },
      },
      handler: async (input) => {
        const result = await engine.startService(
          requireWorkstreamId(ctx),
          String(input.name ?? ''),
        );
        return JSON.stringify(result);
      },
    },
    {
      name: 'stop_service',
      description:
        'Stop a running named service and run its teardown script, if any.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      handler: async (input) => {
        const result = await engine.stopService(
          requireWorkstreamId(ctx),
          String(input.name ?? ''),
        );
        return JSON.stringify(result);
      },
    },
    {
      name: 'list_services',
      description:
        'List every service tracked on this workstream and whether it is currently running.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const result = await engine.listServices(requireWorkstreamId(ctx));
        return JSON.stringify(result);
      },
    },
    {
      name: 'check_service',
      description:
        'Fetch the root URL of a running named service and return its HTTP status and a truncated body, to verify it responds.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      handler: async (input) => {
        const result = await engine.checkService(
          requireWorkstreamId(ctx),
          String(input.name ?? ''),
        );
        return JSON.stringify(result);
      },
    },
  ];
}
