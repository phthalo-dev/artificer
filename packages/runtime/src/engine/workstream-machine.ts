/**
 * Deterministic workstream state machine.
 *
 * This replaces the LLM "orchestrator" role: routing between setup → plan →
 * implement ↔ review → done is mechanical, so it lives in code. An LLM is only
 * invoked for the generative steps (plan, implement, review). The engine gathers
 * facts (from the store + workspace) and this pure function decides the next
 * action — making every transition unit-testable without a model.
 *
 * Phase-based orchestration: the workstream progresses through phases (setup,
 * planning, implementing, verifying, done). The state machine handles routing
 * within a phase. Phase transitions and escalation events trigger orchestrator
 * re-invocation, reducing LLM calls while maintaining flexibility.
 */

import {
  convergenceStallMessage,
  detectConvergenceStallFromCounts,
} from './convergence.js';
import type { WorkstreamPhase } from '../storage/types.js';

/** Consecutive reviews without approval before the workstream is blocked. */
export const MAX_REVIEW_CYCLES = 3;

/** Max iterations within a phase before escalating to orchestrator. */
export const MAX_PHASE_ITERATIONS = 10;

export const PLAN_TASK =
  'Investigate the goal in the local repo (read_file, grep, run_shell). ' +
  'Write a concrete, step-by-step plan with write_plan, including the exact ' +
  'test command to verify the fix. Investigate only what the blackboard does ' +
  'not already cover.';

/**
 * Hint task when a planner finished without write_plan. Stop exploring and
 * commit whatever plan the investigation supports.
 */
export const PLAN_RETRY_TASK =
  'Your previous pass did not call write_plan, so no plan was recorded and the ' +
  'workstream cannot move on. You have already explored the repository — do NOT ' +
  'run more read_file/grep/run_shell unless a single targeted read is strictly ' +
  'necessary. Call write_plan NOW with a concrete step-by-step plan (files to ' +
  'change, exact test command, verification steps). Then stop.';

export const IMPLEMENT_TASK =
  'Implement the plan by editing the repository source in the workspace. ' +
  "Do not modify or add test files. Run the plan's test command to check " +
  'your work. Report BLOCKED if stuck after a few attempts.';

export const FIX_TASK =
  'A review rejected the current change. Address the recorded review issues ' +
  'by editing the repository source, then re-run the test command. Do not ' +
  'modify test files.';

export const REVIEW_TASK =
  'Review the current diff against the goal (read the diff and run the test ' +
  'command). Do not re-explore the whole repo and do not edit files. Call ' +
  'submit_review with approved and any issues.';

/**
 * Hint task for re-dispatching a reviewer that finished without calling
 * submit_review. Telling the model what went wrong in plain text is cheaper
 * than letting it thrash on the same prompt again.
 */
export const REVIEW_RETRY_TASK =
  'Your previous pass did not call submit_review, so no review was recorded ' +
  'and the workstream cannot move on. Read the diff with git_diff, then call ' +
  'submit_review now (with stage "work", severity, approved, and notes). Do ' +
  'NOT re-read the whole repository, do NOT edit files, and do NOT spawn ' +
  'other calls — just submit the review and stop.';

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
  /** Total runs in this workstream (drives the hard run cap). */
  totalRuns: number;
  /** Hard per-workstream run cap. */
  maxRuns: number;
  /** Current phase of the workstream. */
  currentPhase: WorkstreamPhase;
  /** Iterations completed in the current phase. */
  iterationsInPhase: number;
  /** Max iterations allowed in the current phase before escalating. */
  maxPhaseIterations: number;
  /** Number of consecutive rejected reviews (for escalation detection). */
  consecutiveRejectedReviews: number;
  /** Number of planner→reviewer oscillation cycles (for escalation detection). */
  plannerReviewerOscillationCycles: number;
  /**
   * True if the most recent reviewer run completed without calling
   * submit_review. Lets the FSM dispatch a hint task instead of repeating the
   * same prompt and hoping for a different result.
   */
  lastReviewerNoSubmit: boolean;
  /**
   * Trailing count of reviewer runs that finished without submit_review.
   * Once this exceeds MAX_REVIEWER_NO_SUBMIT the FSM escalates instead of
   * looping on the same broken reviewer.
   */
  consecutiveReviewerNoSubmit: number;
  /**
   * True if the most recent planner run completed without calling write_plan.
   * Lets the FSM dispatch PLAN_RETRY_TASK instead of repeating PLAN_TASK.
   */
  lastPlannerNoWritePlan: boolean;
  /**
   * Trailing planner runs (done or failed) that did not call write_plan.
   * Escalates to the orchestrator once this reaches the cap.
   */
  consecutivePlannerNoWritePlan: number;
}

/** Consecutive no-submit reviewer runs before the FSM escalates. */
export const MAX_REVIEWER_NO_SUBMIT = 2;

/** Planner passes without write_plan before escalating to the orchestrator. */
export const MAX_PLANNER_NO_WRITE_BEFORE_ESCALATE = 2;

export type WorkstreamAction =
  | { kind: 'setup' }
  | { kind: 'dispatch'; role: 'planner' | 'worker' | 'reviewer'; task: string }
  | { kind: 'phase_complete'; nextPhase: WorkstreamPhase }
  | { kind: 'escalate'; reason: string }
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

  if (f.currentPhase === 'done') {
    return { kind: 'done' };
  }

  const convergenceStall = detectConvergenceStallFromCounts(
    f.consecutiveRejectedReviews,
    f.plannerReviewerOscillationCycles,
  );
  if (convergenceStall) {
    return {
      kind: 'escalate',
      reason: convergenceStallMessage(convergenceStall),
    };
  }

  if (f.iterationsInPhase >= f.maxPhaseIterations) {
    return {
      kind: 'escalate',
      reason: `Phase "${f.currentPhase}" exceeded ${f.maxPhaseIterations} iterations without completing. The orchestrator should review progress and decide how to proceed.`,
    };
  }

  if (f.consecutiveReviewerNoSubmit >= MAX_REVIEWER_NO_SUBMIT) {
    return {
      kind: 'escalate',
      reason: `Reviewer finished without calling submit_review ${f.consecutiveReviewerNoSubmit} times in a row. The model assigned to the reviewer role is not driving its tools.`,
    };
  }

  switch (f.currentPhase) {
    case 'setup':
      return handleSetupPhase(f);
    case 'planning':
      return handlePlanningPhase(f);
    case 'implementing':
      return handleImplementingPhase(f);
    case 'verifying':
      return handleVerifyingPhase(f);
    default:
      return { kind: 'blocked', reason: `unknown phase: ${f.currentPhase}` };
  }
}

function handleSetupPhase(f: WorkstreamFacts): WorkstreamAction {
  if (f.hasRepoUrl && !f.repoReady) {
    return { kind: 'setup' };
  }
  return { kind: 'phase_complete', nextPhase: 'planning' };
}

function handlePlanningPhase(f: WorkstreamFacts): WorkstreamAction {
  if (!f.planWritten) {
    if (f.consecutivePlannerNoWritePlan >= MAX_PLANNER_NO_WRITE_BEFORE_ESCALATE) {
      return {
        kind: 'escalate',
        reason:
          `Planner finished without calling write_plan ${f.consecutivePlannerNoWritePlan} times in a row ` +
          '(including timed-out runs). The orchestrator should steer planning, define a stronger planner agent, or adjust models.',
      };
    }
    if (f.lastPlannerNoWritePlan) {
      return { kind: 'dispatch', role: 'planner', task: PLAN_RETRY_TASK };
    }
    return { kind: 'dispatch', role: 'planner', task: PLAN_TASK };
  }
  return { kind: 'phase_complete', nextPhase: 'implementing' };
}

function handleImplementingPhase(f: WorkstreamFacts): WorkstreamAction {
  if (!f.patchPresent) {
    return { kind: 'dispatch', role: 'worker', task: IMPLEMENT_TASK };
  }

  if (f.reviewCount === 0 || f.workSinceLastReview > 0) {
    if (f.lastReviewerNoSubmit) {
      return { kind: 'dispatch', role: 'reviewer', task: REVIEW_RETRY_TASK };
    }
    return { kind: 'dispatch', role: 'reviewer', task: REVIEW_TASK };
  }

  if (f.lastReviewApproved === true) {
    return { kind: 'phase_complete', nextPhase: 'verifying' };
  }

  if (f.lastReviewApproved === false) {
    return { kind: 'dispatch', role: 'worker', task: FIX_TASK };
  }

  if (f.lastReviewerNoSubmit) {
    return { kind: 'dispatch', role: 'reviewer', task: REVIEW_RETRY_TASK };
  }
  return { kind: 'dispatch', role: 'reviewer', task: REVIEW_TASK };
}

function handleVerifyingPhase(_f: WorkstreamFacts): WorkstreamAction {
  return { kind: 'done' };
}
