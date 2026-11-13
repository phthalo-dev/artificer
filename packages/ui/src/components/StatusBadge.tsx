import { Badge } from '@var-ui/react';
import type { Tone } from '@var-ui/core';
import type { RunStatus, WorkstreamStatus } from '../api/types';

const WORKSTREAM_TONES: Record<WorkstreamStatus, Tone> = {
  pending: 'neutral',
  planning: 'info',
  reviewing: 'accent',
  in_progress: 'accent',
  paused_quota: 'warning',
  blocked: 'warning',
  done: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const RUN_TONES: Record<RunStatus, Tone> = {
  queued: 'neutral',
  running: 'info',
  done: 'success',
  failed: 'danger',
};

/** Semantic tone for a workstream or run status (`neutral` when unknown). */
export function statusTone(
  status: WorkstreamStatus | RunStatus | string,
): Tone {
  return (
    WORKSTREAM_TONES[status as WorkstreamStatus] ??
    RUN_TONES[status as RunStatus] ??
    'neutral'
  );
}

export function StatusBadge({
  status,
}: {
  status: WorkstreamStatus | RunStatus | string;
}) {
  return <Badge tone={statusTone(status)}>{status.replace(/_/g, ' ')}</Badge>;
}
