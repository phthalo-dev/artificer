import type { TraceEvent, TraceEventKind } from './api/types';

export const TRACE_KIND_COLORS: Record<
  TraceEventKind,
  'blue' | 'violet' | 'orange' | 'gray' | 'yellow' | 'red' | 'green' | 'cyan'
> = {
  message: 'blue',
  workstream: 'violet',
  task: 'cyan',
  run: 'orange',
  tool: 'gray',
  review: 'green',
  finding: 'yellow',
  approval: 'red',
  quota: 'yellow',
  receipt: 'green',
  artifact: 'cyan',
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Human-readable one-line summary for a durable trace event. */
export function traceEventLabel(event: TraceEvent): string {
  const data = event.data;
  switch (event.kind) {
    case 'message': {
      const direction = asString(data.direction) ?? 'message';
      const content = asString(data.content);
      return content
        ? `${direction}: ${content.slice(0, 120)}${content.length > 120 ? '…' : ''}`
        : direction;
    }
    case 'workstream': {
      const name = asString(data.event) ?? asString(data.status) ?? 'updated';
      const title = asString(data.title);
      return title ? `workstream ${name}: ${title}` : `workstream ${name}`;
    }
    case 'task': {
      const role = asString(data.role) ?? 'task';
      const status = asString(data.status);
      const description = asString(data.description);
      const head = [role, status].filter(Boolean).join(' · ');
      return description
        ? `${head}: ${description.slice(0, 100)}`
        : head || 'task update';
    }
    case 'run': {
      const role = asString(data.role) ?? event.actor?.role ?? 'agent';
      const status = asString(data.status) ?? 'update';
      const task = asString(data.task);
      return task
        ? `${role} ${status}: ${task.slice(0, 100)}`
        : `${role} ${status}`;
    }
    case 'tool': {
      const name = asString(data.name) ?? 'tool';
      const error = asString(data.error);
      return error ? `${name} failed` : name;
    }
    case 'review': {
      const target = asString(data.target) ?? 'review';
      const approved = data.approved === true;
      return `${target} · ${approved ? 'approved' : 'changes requested'}`;
    }
    case 'finding': {
      const summary = asString(data.summary) ?? 'finding recorded';
      return summary.slice(0, 120);
    }
    case 'approval': {
      const tool = asString(data.tool) ?? 'approval';
      const decision = asString(data.decision);
      return decision ? `${tool}: ${decision}` : tool;
    }
    case 'quota': {
      const name = asString(data.event) ?? 'quota update';
      return `quota ${name}`;
    }
    case 'receipt': {
      const version = asString(data.schemaVersion);
      return version ? `receipt generated (v${version})` : 'receipt generated';
    }
    case 'artifact': {
      const key = asString(data.key) ?? 'artifact';
      const version = asString(data.version);
      const action = asString(data.action) ?? 'updated';
      return version ? `${key} ${action} (${version})` : `${key} ${action}`;
    }
    default:
      return event.kind;
  }
}
