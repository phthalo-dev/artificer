import { Badge } from '@mantine/core';
import type { RunStatus, WorkstreamStatus } from '../api/types';

const WORKSTREAM_COLORS: Record<WorkstreamStatus, string> = {
  pending: 'gray',
  planning: 'blue',
  reviewing: 'violet',
  in_progress: 'cyan',
  blocked: 'orange',
  done: 'green',
  failed: 'red',
  cancelled: 'gray',
};

const RUN_COLORS: Record<RunStatus, string> = {
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
    <Badge color={color} variant="light" radius="sm">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
