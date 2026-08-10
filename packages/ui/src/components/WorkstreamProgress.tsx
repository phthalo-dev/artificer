import { Badge, type BadgeColor, Group } from '../ds';
import type { RetryCounter, WorkstreamProgress as Progress } from '../api/types';

const LABELS: Record<keyof Progress, string> = {
  reviewCycles: 'review cycles',
  workerRunsSinceReview: 'worker runs since review',
  noProgressRepeats: 'no-progress repeats',
  consecutiveFailedRuns: 'consecutive failed runs',
  plannerAttempts: 'planner attempts',
  totalRuns: 'total runs',
};

function counterColor(c: RetryCounter): BadgeColor {
  if (c.max <= 0) return 'gray';
  if (c.count >= c.max) return 'red';
  if (c.count >= c.max - 1) return 'orange';
  return 'gray';
}

/**
 * Shows the state machine's retry/attempt counters (see MAX_* constants in
 * packages/runtime/src/engine/workstream-machine.ts and worker-progress.ts)
 * as "N of M" badges, so how close a workstream is to being auto-blocked is
 * visible before it actually blocks.
 */
export function WorkstreamProgress({ progress }: { progress: Progress }) {
  const visible = (Object.keys(progress) as Array<keyof Progress>).filter(
    (key) => progress[key].count > 0,
  );
  if (visible.length === 0) return null;

  return (
    <Group gap="xs" wrap="wrap">
      {visible.map((key) => {
        const c = progress[key];
        return (
          <Badge key={key} color={counterColor(c)} variant="light">
            {LABELS[key]}: {c.count} of {c.max}
          </Badge>
        );
      })}
    </Group>
  );
}
