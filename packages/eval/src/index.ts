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
export {
  runIdentityEval,
  LLM_JUDGE_ENV,
  llmJudgeEnabled,
} from './driver/run-suite.js';
export { listEvalPacks, getEvalPack } from './packs/registry.js';
export { loadEvalPack, sweBenchInstanceToEvalTask } from './packs/load-pack.js';
export { SWE_BENCH_LITE_30_PACK_ID } from './packs/swebench-lite-30.js';
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
export {
  gradeLlmJudge,
  parseLlmJudgeVerdict,
  type LlmJudgeComplete,
} from './identity/grade-llm-judge.js';
