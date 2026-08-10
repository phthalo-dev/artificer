import { Badge, type BadgeColor, Group } from '../ds';
import type {
  RetryCounter,
  WorkstreamProgress as Progress,
  WorkstreamStatus,
} from '../api/types';

const LABELS: Record<keyof Progress, string> = {
  reviewCycles: 'review cycles',
  workerRunsSinceReview: 'worker runs since review',
  noProgressRepeats: 'no-progress repeats',
  consecutiveFailedRuns: 'consecutive failed runs',
  plannerAttempts: 'planner attempts',
  totalRuns: 'total runs',
};

/**
 * Counters whose cap is a structurally benign transition, never a cause of
 * `blocked`, so they should never escalate to orange/red — the count is
 * still shown, just never alarm-colored:
 *  - workerRunsSinceReview hitting MAX_WORKER_RUNS_BEFORE_REVIEW just
 *    dispatches a reviewer (workstream-machine.ts:198-204).
 *  - plannerAttempts hitting MAX_PLANNER_ATTEMPTS falls through to direct
 *    implementation instead of blocking (workstream-machine.ts:160-166).
 */
const NEVER_ALARM = new Set<keyof Progress>([
  'workerRunsSinceReview',
  'plannerAttempts',
]);

/**
 * Non-terminal statuses where hitting a cap could still lead to `blocked` —
 * i.e. the counters are a live risk signal. `blocked`/`failed` are handled
 * separately below (also escalated, since there the color explains why the
 * workstream stopped); `done`/`cancelled` are excluded (nothing is wrong).
 */
const LIVE_RISK_STATUSES = new Set<WorkstreamStatus>([
  'pending',
  'planning',
  'reviewing',
  'in_progress',
  'paused_quota',
]);

function escalate(c: RetryCounter): BadgeColor {
  if (c.max <= 0) return 'gray';
  if (c.count >= c.max) return 'red';
  if (c.count >= c.max - 1) return 'orange';
  return 'gray';
}

function counterColor(
  key: keyof Progress,
  c: RetryCounter,
  status: WorkstreamStatus,
): BadgeColor {
  // Structurally benign counters never alarm, regardless of status.
  if (NEVER_ALARM.has(key)) return 'gray';

  // done/cancelled: nothing is wrong — the counters are historical record,
  // not a live risk signal, so never alarm-color them.
  if (status === 'done' || status === 'cancelled') return 'gray';

  // Live in-progress statuses (a cap could still lead to blocked) and
  // blocked/failed (the color explains why it stopped) both escalate.
  if (
    LIVE_RISK_STATUSES.has(status) ||
    status === 'blocked' ||
    status === 'failed'
  ) {
    return escalate(c);
  }
  return 'gray';
}

/**
 * Shows the state machine's retry/attempt counters (see MAX_* constants in
 * packages/runtime/src/engine/workstream-machine.ts and worker-progress.ts)
 * as "N of M" badges, so how close a workstream is to being auto-blocked is
 * visible before it actually blocks. Coloring depends on `status`: see
 * counterColor above for which counters/statuses actually escalate.
 */
export function WorkstreamProgress({
  progress,
  status,
}: {
  progress: Progress;
  status: WorkstreamStatus;
}) {
  const visible = (Object.keys(progress) as Array<keyof Progress>).filter(
    (key) => progress[key].count > 0,
  );
  if (visible.length === 0) return null;

  return (
    <Group gap="xs" wrap="wrap">
      {visible.map((key) => {
        const c = progress[key];
        return (
          <Badge key={key} color={counterColor(key, c, status)} variant="light">
            {LABELS[key]}: {c.count} of {c.max}
          </Badge>
        );
      })}
    </Group>
  );
}
