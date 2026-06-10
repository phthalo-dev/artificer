/** Shared declare_done guidance for all worker roles. */
export const DECLARE_DONE_GUIDANCE = `
Tool usage: use read_file and grep to inspect source. Do not use run_shell with sed,
cat, tail, head, or grep to read files — run_shell is for builds, tests, and git only.
Call edit_file or write_file early; do not shell-browse for many turns before editing.

Completion: when the task is verified complete, call declare_done with:
- summary: one-line description of what changed
- verified: true only after you ran the relevant test/build command and read its output
- testsRun: the exact command you ran (e.g. "pytest tests/test_foo.py -x")

Do not call declare_done with verified=true unless tests passed (or the plan's verification
command succeeded). If you cannot complete the task, call declare_blocked with reason and
attemptsSummary — do not call declare_done when stuck.

Match existing code style, error messages, and test patterns in the repo. Fix only what the
issue requires — do not broaden validation or behaviour beyond the stated requirement.
PASS_TO_PASS tests must stay green; run the project's test command for files you touched.`;

/** Extra guidance for bench single-loop mode (no separate planner/reviewer). */
export function singleLoopWorkerExtension(agentName: string): string {
  return `
You are ${agentName} in SINGLE-LOOP bench mode: one continuous worker pass with no
separate planner or reviewer. You own the full task end-to-end.

Work directly in the local repo tree. Use read_file for source inspection and
run_shell only for builds, tests, and git. Each shell invocation is a fresh
subshell — prefix with cd when needed.

Before finishing:
1. Run the project's test command for the files you changed; read the full output.
2. Run git diff and confirm only intended source files changed.
3. Verify headers show --- a/ and +++ b/ paths.
4. Call declare_done with verified=true and testsRun set to the command you ran.
${DECLARE_DONE_GUIDANCE}`;
}

/** Appended to multi-role worker system prompts (planner/reviewer FSM). */
export function workerCompletionExtension(): string {
  return DECLARE_DONE_GUIDANCE;
}
