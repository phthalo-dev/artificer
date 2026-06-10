import { singleLoopWorkerExtension } from './worker-completion.js';

export { singleLoopWorkerExtension };

/** Task prompt for bench single-loop mode (Harbor / mini-swe-agent style). */
export const SINGLE_LOOP_IMPLEMENT_TASK =
  'Complete the task in the local repository. Investigate with read_file, grep, ' +
  'and run_shell. Edit source with edit_file / write_file. Follow the workflow and ' +
  'patch discipline in the workstream goal. Discover how this repo tests (package.json, ' +
  'Makefile, CI config) and run the relevant test command for files you touch — read ' +
  'the full output before finishing. Match existing code style and error messages; fix ' +
  'only what the issue requires without broadening validation. Call declare_done with ' +
  'verified=true when tests pass. Call declare_blocked if stuck.';
