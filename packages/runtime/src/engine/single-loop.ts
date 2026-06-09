/** Task prompt for bench single-loop mode (Harbor / mini-swe-agent style). */
export const SINGLE_LOOP_IMPLEMENT_TASK =
  'Complete the task in the local repository. Investigate with read_file, grep, ' +
  'and run_shell. Edit source with edit_file / write_file. Follow the workflow and ' +
  'patch discipline in the workstream goal. Run the project test/build command and ' +
  'read its output before finishing. End with DONE when verified, BLOCKED if stuck.';

/** Extended system guidance appended to the worker role in single-loop mode. */
export function singleLoopWorkerExtension(agentName: string): string {
  return `
You are ${agentName} in SINGLE-LOOP bench mode: one continuous worker pass with no
separate planner or reviewer. You own the full task end-to-end.

Work directly in the local repo tree. Use run_shell for builds, tests, and git
inspection. Each shell invocation is a fresh subshell — prefix with cd when needed.

Before finishing:
1. Run git diff and confirm only intended source files changed.
2. Verify headers show --- a/ and +++ b/ paths.
3. Report DONE with a one-line summary of what changed.`;
}
