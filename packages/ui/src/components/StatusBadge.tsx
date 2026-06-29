import { Badge, type BadgeColor } from '../ds';
import type { RunStatus, WorkstreamStatus } from '../api/types';

const WORKSTREAM_COLORS: Record<WorkstreamStatus, BadgeColor> = {
  pending: 'gray',
  planning: 'blue',
  reviewing: 'violet',
  in_progress: 'cyan',
  paused_quota: 'yellow',
  blocked: 'orange',
  done: 'green',
  failed: 'red',
  cancelled: 'gray',
};

const RUN_COLORS: Record<RunStatus, BadgeColor> = {
  queued: 'gray',
  running: 'blue',
  done: 'green',
  failed: 'red',
};

export function StatusBadge({
  status,
}: {
  status: WorkstreamStatus | RunStatus | string;
}) {
  const color =
    WORKSTREAM_COLORS[status as WorkstreamStatus] ??
    RUN_COLORS[status as RunStatus] ??
    'gray';
  return (
    <Badge color={color} variant="light">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
