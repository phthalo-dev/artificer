/**
 * Deterministic workstream state machine.
 *
 * This replaces the LLM "orchestrator" role: routing between setup → plan →
 * implement ↔ review → done is mechanical, so it lives in code. An LLM is only
 * invoked for the generative steps (plan, implement, review). The engine gathers
 * facts (from the store + workspace) and this pure function decides the next
 * action — making every transition unit-testable without a model.
 */

import { MAX_NO_PROGRESS_REPEATS } from './worker-progress.js';

/** Consecutive reviews without approval before the workstream is blocked. */
export const MAX_REVIEW_CYCLES = 3;

/**
 * Worker runs allowed since the last review before forcing a review, even if
 * the worker never reports DONE. Lets a large task accumulate implementation
 * across several worker runs instead of being reviewed after its first edit.
 */
export const MAX_WORKER_RUNS_BEFORE_REVIEW = 5;

/**
 * Consecutive failed runs before the workstream is blocked. Guards against a
 * failing model or a rate-limited/unavailable endpoint: without this the state
 * machine would re-dispatch the same role until the hard run cap.
 */
export const MAX_FAILED_RUNS = 3;

/**
 * Planner runs that finished without producing a plan before the workstream is
 * blocked. A planner that succeeds but never calls write_plan is not "failed",
 * so without this guard the machine re-dispatches it until the wall-clock
 * timeout (observed: a planner looping 9× on a hard repo, no patch).
 */
export const MAX_PLANNER_ATTEMPTS = 3;

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
  'related code paths), not just the headline. Run the plan’s test command to ' +
  'check your work. Do not modify or add test files. Record any new fact with ' +
  'record_finding. Report BLOCKED if stuck.';

/** Task when planning could not produce a plan: the worker does it all. */
export const IMPLEMENT_DIRECT_TASK =
  'No usable plan was produced, so implement the goal directly. Investigate the ' +
  'repository (read_file, grep, run_shell), then edit the source to make the ' +
  'issue’s FULL described behaviour correct — cover every case it mentions, not ' +
  'just the headline. Run the project’s tests to check your work. Do not modify ' +
  'or add test files. Record key facts with record_finding. Report BLOCKED if ' +
  'genuinely stuck.';

export const SUBMIT_TASK =
  'The review approved your changes. Now submit them as a pull request:\n' +
  '1. Create a descriptive branch name from the workstream title (e.g. add-contributing-guidelines).\n' +
  '2. Stage and commit all changes with a clear commit message.\n' +
  '3. Try pushing the branch to origin. If the push fails with a 403 or permission error,\n' +
  '   you do not have push access to the upstream repo — fork it first:\n' +
  '   a. Run `gh repo fork --remote=true` to create a fork and add it as a remote.\n' +
  '   b. Push to the fork remote instead (usually named "origin" after forking, with upstream renamed).\n' +
  '4. Open a pull request with `gh pr create` — include a summary of what changed and why.\n' +
  '   When working from a fork, `gh pr create` automatically targets the upstream repo.\n' +
  '5. Report the PR URL in report_status so it can be tracked.\n' +
  'Do not modify any files. Only create the branch, commit, push, and open the PR.';

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
  /** Whether the most recent worker run reported it had finished (DONE). */
  lastWorkerDone: boolean;
  /** Trailing runs that failed (e.g. the LLM endpoint erroring/rate-limited). */
  consecutiveFailedRuns: number;
  /** Completed planner runs that did not produce a plan (planning is stuck). */
  plannerRunsWithoutPlan: number;
  /** Trailing worker runs since the last review with no progress (thrash). */
  noProgressRepeats: number;
  /** Whether changes have been pushed and a PR opened. */
  prSubmitted: boolean;
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

  // Plan before any implementation — but if the planner keeps finishing without
  // a plan, don't block: fall through to a worker that investigates and
  // implements directly (single-agent style), so a flaky planner can't stall an
  // otherwise-doable task.
  if (!f.planWritten && f.plannerRunsWithoutPlan < MAX_PLANNER_ATTEMPTS) {
    return { kind: 'dispatch', role: 'planner', task: PLAN_TASK };
  }

  // If the review already approved, route to submit or done — checked before
  // patchPresent so a committed (clean) working tree doesn't re-trigger
  // implementation after the submit worker commits the change.
  if (f.lastReviewApproved === true) {
    if (f.hasRepoUrl && !f.prSubmitted) {
      return { kind: 'dispatch', role: 'worker', task: SUBMIT_TASK };
    }
    return { kind: 'done' };
  }

  // Implement until there is a candidate patch — from the plan if we have one,
  // otherwise directly from the goal.
  if (!f.patchPresent) {
    return {
      kind: 'dispatch',
      role: 'worker',
      task: f.planWritten ? IMPLEMENT_TASK : IMPLEMENT_DIRECT_TASK,
    };
  }

  // There is unreviewed worker output. Let the worker keep implementing until it
  // reports DONE or hits the per-review cap, THEN review — so a large task is
  // not reviewed (and rejected) after only its first edit.
  if (f.reviewCount === 0 || f.workSinceLastReview > 0) {
    if (
      f.lastWorkerDone ||
      f.workSinceLastReview >= MAX_WORKER_RUNS_BEFORE_REVIEW
    ) {
      return { kind: 'dispatch', role: 'reviewer', task: REVIEW_TASK };
    }
    if (f.noProgressRepeats >= MAX_NO_PROGRESS_REPEATS) {
      return {
        kind: 'blocked',
        reason: `not_converging: worker made no progress across ${f.noProgressRepeats} consecutive runs`,
      };
    }
    return {
      kind: 'dispatch',
      role: 'worker',
      task: f.planWritten ? IMPLEMENT_TASK : IMPLEMENT_DIRECT_TASK,
    };
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
