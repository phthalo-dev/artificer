export const EVAL_PACKAGE = '@artificer-ai/eval';

export type {
  EvalTaskKind,
  EvalGrade,
  EvalTaskManifest,
  EvalSuiteDefinition,
  LoadedEvalTask,
  EvalRunOptions,
  EvalTaskResult,
} from './types.js';

export { parseEvalTaskManifest, parseEvalSuite } from './types.js';

export { resolveEvalsDir } from './identity/paths.js';
export { loadEvalSuite, listEvalSuites } from './identity/load-suite.js';
export { loadEvalTask, listEvalTasks } from './identity/load-task.js';
export {
  startEvalRuntime,
  type EvalRuntimeOptions,
  type EvalRuntimeHandle,
} from './driver/runtime.js';
export { runIdentityEval } from './driver/run-suite.js';
