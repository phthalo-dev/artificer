import { WORKER_BLOCKED_TOOL, WORKER_DONE_TOOL } from './terminal-tools.js';

/** User message injected when a worker must call a terminal tool before finishing. */
export function completionReminderText(
  doneTool = WORKER_DONE_TOOL,
  blockedTool = WORKER_BLOCKED_TOOL,
): string {
  return (
    `[SYSTEM] This run is not complete until you call ${doneTool} with ` +
    'verified=true after running the relevant tests, or ' +
    `${blockedTool} if you are stuck. Continue working if requirements are not met. ` +
    `A text-only response without ${doneTool} or ${blockedTool} does not finish the run.`
  );
}

/** True when the model ended with an explicit BLOCKED status (worker escape hatch). */
export function isBlockedStatusText(text: string): boolean {
  return /^BLOCKED\b/m.test(text.trim());
}

/** Injected when a planner has explored long enough without calling write_plan. */
export function plannerWritePlanReminderText(): string {
  return (
    '[SYSTEM] You have not called write_plan yet. Stop exploring and call write_plan NOW ' +
    'with a concrete step-by-step plan: exact file paths, code changes, and the test command ' +
    'to verify the fix. Exploration-only runs without write_plan are failures.'
  );
}

/** Injected when a worker browses via run_shell without editing. */
export function workerEditReminderText(): string {
  return (
    '[SYSTEM] You have run many shell read commands without editing. Stop browsing. ' +
    'Use read_file for source inspection, then call edit_file or write_file NOW to implement the plan. ' +
    'Reserve run_shell for builds, tests, and git only.'
  );
}

/** Injected when a worker repeatedly reads the same file via run_shell. */
export function shellBrowseLoopWarningText(target?: string): string {
  const file = target ? ` (${target})` : '';
  return (
    `You are re-reading the same file via run_shell${file}. ` +
    'Use read_file instead, then call edit_file to implement.'
  );
}
