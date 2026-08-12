import type { RuntimeState } from './client.js';
import type { AttemptOutcome, AttemptRecord, WorkstreamStatus } from '../bench/types.js';

/** Workstream statuses the harness treats as final. */
export const TERMINAL = new Set<string>([
  'done',
  'failed',
  'cancelled',
  'blocked',
]);

export type PollDecision =
  | {
      kind: 'terminal';
      outcome: AttemptOutcome;
      workstreamStatus: AttemptRecord['workstreamStatus'];
    }
  | { kind: 'stalled' }
  | { kind: 'wait'; idleSince?: number };

function terminalOutcome(status: string): AttemptOutcome {
  if (status === 'done') return 'submitted';
  if (status === 'blocked') return 'blocked';
  return 'failed';
}

/**
 * Decide what the instance poll loop should do given the current runtime state.
 * Pure so the loop's termination logic is unit-testable.
 *
 * - A terminal workstream ends the instance with the mapped outcome.
 * - Otherwise, whenever nothing is running or queued (`!busy`) we accrue idle
 *   time. This covers BOTH "no workstream started yet" and the more subtle
 *   "workstream exists but the orchestrator stalled without dispatching work" —
 *   in either case, once idle exceeds the grace window the instance is failed
 *   rather than left to burn the full timeout.
 * - Any in-flight work resets the idle clock.
 */
export function decidePoll(
  state: RuntimeState,
  idleSince: number | undefined,
  now: number,
  idleGraceMs: number,
): PollDecision {
  const ws = state.workstreams[0];
  if (ws && TERMINAL.has(ws.status)) {
    return {
      kind: 'terminal',
      outcome: terminalOutcome(ws.status),
      workstreamStatus: ws.status as WorkstreamStatus,
    };
  }

  if (!state.busy) {
    const since = idleSince ?? now;
    if (now - since > idleGraceMs) return { kind: 'stalled' };
    return { kind: 'wait', idleSince: since };
  }

  return { kind: 'wait', idleSince: undefined };
}
