export const EVAL_PACKAGE = '@artificer-ai/eval';

export type {
  EvalTaskKind,
  EvalGrade,
  EvalRepoPin,
  EvalTaskManifest,
  EvalSuiteDefinition,
  LoadedEvalTask,
  EvalRunOptions,
  EvalTaskResult,
} from './types.js';

export {
  FIXTURE_REPO_URL,
  parseEvalTaskManifest,
  parseEvalSuite,
} from './types.js';

export { resolveEvalsDir } from './identity/paths.js';
export { loadEvalSuite, listEvalSuites } from './identity/load-suite.js';
export { loadEvalTask, listEvalTasks } from './identity/load-task.js';
export {
  startEvalRuntime,
  type EvalRuntimeOptions,
  type EvalRuntimeHandle,
} from './driver/runtime.js';
export { runIdentityEval } from './driver/run-suite.js';
export {
  compareEvalRuns,
  formatCompareTable,
  resolveCompareRunDirs,
  type EvalCompareResult,
  type EvalCompareSummary,
  type CompareEvalRunsOptions,
} from './driver/compare.js';
export {
  gradeFileExists,
  gradeMessageContains,
  gradeWorkstreamStatus,
} from './identity/grade.js';
