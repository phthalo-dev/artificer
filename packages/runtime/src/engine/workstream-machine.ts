/**
 * Deterministic workstream state machine.
 *
 * This replaces the LLM "orchestrator" role: routing between setup → plan →
 * implement ↔ review → done is mechanical, so it lives in code. An LLM is only
 * invoked for the generative steps (plan, implement, review). The engine gathers
 * facts (from the store + workspace) and this pure function decides the next
 * action — making every transition unit-testable without a model.
 */

/** Consecutive reviews without approval before the workstream is blocked. */
export const MAX_REVIEW_CYCLES = 3;

/**
 * Consecutive failed runs before the workstream is blocked. Guards against a
 * failing model or a rate-limited/unavailable endpoint: without this the state
 * machine would re-dispatch the same role until the hard run cap.
 */
export const MAX_FAILED_RUNS = 3;

export const PLAN_TASK =
  'Write the implementation plan for this goal and call write_plan in THIS run. ' +
  'Do minimal investigation first — read the file(s) the issue points to and ' +
  'grep the relevant symbol (a few calls), then write a short plan naming the ' +
  'root-cause file and lines, the exact change, and the command to verify the ' +
  'fix. Do not do git-history archaeology or read unrelated files. Record the ' +
  'root cause and the verify command with record_finding so the worker need ' +
  'not re-investigate.';

export const IMPLEMENT_TASK =
  'Read the recorded findings first and trust them — do not re-investigate what ' +
  'they already establish. Implement the plan by editing the repository source ' +
  'in the workspace, making the issue’s FULL described behaviour correct: cover ' +
  'every case the issue mentions (including asides like “also”/“as well” and ' +
  'related code paths), not just the headline. Write a reproduction exercising ' +
  'each case and confirm they all pass before finishing. Do not modify or add ' +
  'test files. Record any new fact with record_finding. Report BLOCKED if stuck.';

export const FIX_TASK =
  'A review rejected the current change. Read the findings and recorded review ' +
  'issues, address them by editing the repository source, then re-run the test ' +
  'command. Do not modify test files.';

export const REVIEW_TASK =
  'Review the current diff against the goal using the recorded findings and the ' +
  'diff — do not re-explore the whole repo and do not edit files. Run the test ' +
  'command, then call submit_review with approved and any issues.';

export interface WorkstreamFacts {
  /** The workstream targets a repository (repoUrl set). */
  hasRepoUrl: boolean;
  /** A git repository exists in the workspace. */
  repoReady: boolean;
  /** A plan artifact has been written. */
  planWritten: boolean;
  /** The working tree has uncommitted changes (a candidate patch). */
  patchPresent: boolean;
  /** Number of reviews recorded so far. */
  reviewCount: number;
  /** Whether the most recent review approved (undefined when none yet). */
  lastReviewApproved?: boolean;
  /** Worker runs completed since the last review (or since the start). */
  workSinceLastReview: number;
  /** Trailing runs that failed (e.g. the LLM endpoint erroring/rate-limited). */
  consecutiveFailedRuns: number;
  /** Total runs in this workstream (drives the hard run cap). */
  totalRuns: number;
  /** Hard per-workstream run cap. */
  maxRuns: number;
}

export type WorkstreamAction =
  | { kind: 'setup' }
  | { kind: 'dispatch'; role: 'planner' | 'worker' | 'reviewer'; task: string }
  | { kind: 'done' }
  | { kind: 'blocked'; reason: string };

/**
 * Decide the next action for a workstream from its current facts. Pure: same
 * facts always yield the same action.
 */
export function nextWorkstreamAction(f: WorkstreamFacts): WorkstreamAction {
  if (f.totalRuns >= f.maxRuns) {
    return { kind: 'blocked', reason: `run cap (${f.maxRuns}) reached` };
  }

  // Stop re-dispatching into a failing model/endpoint (e.g. a usage limit)
  // rather than burning to the run cap.
  if (f.consecutiveFailedRuns >= MAX_FAILED_RUNS) {
    return {
      kind: 'blocked',
      reason: `${f.consecutiveFailedRuns} runs in a row failed (model or endpoint unavailable)`,
    };
  }

  // Setup gate: a repo task with no local clone yet must be set up first.
  if (f.hasRepoUrl && !f.repoReady) {
    return { kind: 'setup' };
  }

  // Plan before any implementation.
  if (!f.planWritten) {
    return { kind: 'dispatch', role: 'planner', task: PLAN_TASK };
  }

  // Implement until there is a candidate patch.
  if (!f.patchPresent) {
    return { kind: 'dispatch', role: 'worker', task: IMPLEMENT_TASK };
  }

  // A candidate patch exists.
  if (f.lastReviewApproved === true) {
    return { kind: 'done' };
  }

  // New, unreviewed work (or never reviewed) → review it.
  if (f.reviewCount === 0 || f.workSinceLastReview > 0) {
    return { kind: 'dispatch', role: 'reviewer', task: REVIEW_TASK };
  }

  // Last review rejected and the worker has not yet addressed it.
  if (f.reviewCount >= MAX_REVIEW_CYCLES) {
    return {
      kind: 'blocked',
      reason: `not converging after ${f.reviewCount} reviews`,
    };
  }
  return { kind: 'dispatch', role: 'worker', task: FIX_TASK };
}
