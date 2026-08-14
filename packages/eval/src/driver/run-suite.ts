import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AttemptRecord } from '../bench/types.js';
import { loadEvalSuite } from '../identity/load-suite.js';
import { loadEvalTask } from '../identity/load-task.js';
import {
  applySweBenchReport,
  predictionsFromResults,
  runSweBenchHarness,
  writePredictionsJsonl,
} from '../identity/grade-swebench.js';
import {
  defaultLlmJudgeComplete,
  type LlmJudgeComplete,
} from '../identity/grade-llm-judge.js';
import { loadEvalPack } from '../packs/load-pack.js';
import type {
  EvalRunOptions,
  EvalTaskResult,
  LoadedEvalTask,
} from '../types.js';
import { runGreenfieldTask } from './run-greenfield-task.js';
import { runMessageTask } from './run-message-task.js';
import { runRepoPatchTask } from './run-repo-patch-task.js';
import { runWorkstreamTask } from './run-workstream-task.js';
import { writeReport } from './report.js';
import { newEvalRunDir, updateLatestSymlink } from './results-paths.js';
import { startEvalRuntime, type EvalRuntimeHandle } from './runtime.js';

const execFileAsync = promisify(execFile);

export const LLM_JUDGE_ENV = 'ARTIFICER_EVAL_LLM_JUDGE';

interface EvalReport {
  schema_version: number;
  total_instances: number;
  resolved_instances: number;
  unresolved_instances: number;
  empty_patch_instances: number;
  error_instances: number;
  completed_instances: number;
  resolved_ids: string[];
  unresolved_ids: string[];
  empty_patch_ids: string[];
  error_ids: string[];
  completed_ids: string[];
}

interface RunIdentityEvalDependencies {
  loadEvalSuite: typeof loadEvalSuite;
  loadEvalTask: typeof loadEvalTask;
  loadEvalPack: typeof loadEvalPack;
  startEvalRuntime: typeof startEvalRuntime;
  runMessageTask: typeof runMessageTask;
  runWorkstreamTask: typeof runWorkstreamTask;
  runGreenfieldTask: typeof runGreenfieldTask;
  runRepoPatchTask: typeof runRepoPatchTask;
  writeReport: typeof writeReport;
  getIdentityGitSha: (identityDir: string) => Promise<string>;
  llmJudgeComplete: LlmJudgeComplete;
  runSweBenchHarness: typeof runSweBenchHarness;
}

const defaultDependencies: RunIdentityEvalDependencies = {
  loadEvalSuite,
  loadEvalTask,
  loadEvalPack,
  startEvalRuntime,
  runMessageTask,
  runWorkstreamTask,
  runGreenfieldTask,
  runRepoPatchTask,
  writeReport,
  getIdentityGitSha,
  llmJudgeComplete: defaultLlmJudgeComplete,
  runSweBenchHarness,
};

export function llmJudgeEnabled(options: EvalRunOptions): boolean {
  return (
    options.llmJudge === true || process.env[LLM_JUDGE_ENV] === 'true'
  );
}

function assertLlmJudgeAllowed(
  tasks: LoadedEvalTask[],
  options: EvalRunOptions,
): void {
  const needsJudge = tasks.some(
    (task) => task.manifest.grade.type === 'llm-judge',
  );
  if (needsJudge && !llmJudgeEnabled(options)) {
    throw new Error(
      'llm-judge grader requires --llm-judge or ARTIFICER_EVAL_LLM_JUDGE=true',
    );
  }
}

export async function runIdentityEval(
  options: EvalRunOptions = {},
  dependencyOverrides: Partial<RunIdentityEvalDependencies> = {},
): Promise<{ resultsDir: string }> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const identityDir = path.resolve(options.identityDir ?? process.cwd());
  const identityName = path.basename(identityDir);
  const execDir = path.resolve(
    options.execDir ??
      process.env.ARTIFICER_EXEC_DIR ??
      path.join(os.homedir(), '.artificer', identityName, 'eval-runs'),
  );
  const identityGitSha = await dependencies.getIdentityGitSha(identityDir);

  let suiteName: string;
  let recordedSuiteId: string | null;
  let taskIds: string[];
  let packedTasks: LoadedEvalTask[] | undefined;

  if (options.packId) {
    const packed = await dependencies.loadEvalPack({
      packId: options.packId,
      limit: options.limit,
    });
    packedTasks = packed.tasks;
    suiteName = packed.suite.name;
    recordedSuiteId = options.packId;
    taskIds = packed.suite.taskIds;
  } else if (options.taskId) {
    suiteName = options.taskId;
    recordedSuiteId = null;
    taskIds = [options.taskId];
  } else {
    const loaded = await dependencies.loadEvalSuite(
      identityDir,
      options.suiteId ?? 'smoke',
    );
    suiteName = loaded.name;
    recordedSuiteId = options.suiteId ?? 'smoke';
    taskIds = loaded.taskIds;
    if (options.limit && options.limit > 0) {
      taskIds = taskIds.slice(0, options.limit);
    }
  }

  const runLabel =
    options.packId ?? options.taskId ?? recordedSuiteId ?? 'eval';
  const resultsDir = path.resolve(
    options.resultsDir ?? newEvalRunDir(execDir, runLabel),
  );

  await fs.mkdir(path.join(resultsDir, 'runs'), { recursive: true });
  const attempts: AttemptRecord[] = [];
  let taskResults: EvalTaskResult[] = [];
  const tasks: LoadedEvalTask[] = [];
  await writeArtifacts(resultsDir, attempts, taskResults);

  let runtime: EvalRuntimeHandle | undefined;
  try {
    if (packedTasks) {
      tasks.push(...packedTasks);
    } else {
      for (const taskId of taskIds) {
        tasks.push(await dependencies.loadEvalTask(identityDir, taskId));
      }
    }
    assertLlmJudgeAllowed(tasks, options);

    runtime = await dependencies.startEvalRuntime({
      identityDir,
      execDir,
      presetId: options.presetId,
    });

    for (const task of tasks) {
      const taskResult = await dispatchTask(runtime, task, dependencies);
      taskResults.push(taskResult);
      attempts.push(toAttempt(taskResult, identityName, identityGitSha));

      await Promise.all([
        writeArtifacts(resultsDir, attempts, taskResults),
        writeJson(
          path.join(resultsDir, 'runs', `${task.manifest.id}.json`),
          taskResult,
        ),
      ]);
    }

    const hasSweBench = tasks.some(
      (task) => task.manifest.grade.type === 'swebench',
    );
    if (hasSweBench) {
      const modelName = options.presetId ?? options.packId ?? 'artificer-eval';
      await writePredictionsJsonl(
        resultsDir,
        predictionsFromResults(taskResults, modelName),
      );
      const report = await dependencies.runSweBenchHarness(resultsDir);
      if (report) {
        taskResults = applySweBenchReport(taskResults, report);
        for (let i = 0; i < attempts.length; i++) {
          const next = taskResults[i];
          if (!next) continue;
          attempts[i] = toAttempt(next, identityName, identityGitSha);
        }
        await writeArtifacts(resultsDir, attempts, taskResults);
      }
    }

    await writeJson(
      path.join(resultsDir, 'instances.json'),
      tasks.map((task) => task.manifest),
    );
    await dependencies.writeReport(resultsDir);
  } finally {
    await runtime?.stop();
  }

  await updateLatestSymlink(execDir, resultsDir);
  await writeJson(path.join(resultsDir, 'run-config.json'), {
    identityDir,
    identityGitSha,
    execDir,
    resultsDir,
    suiteId: recordedSuiteId,
    suiteName,
    taskId: options.taskId ?? null,
    packId: options.packId ?? null,
    taskIds,
    presetId: options.presetId ?? null,
    llmJudge: llmJudgeEnabled(options),
    createdAt: new Date().toISOString(),
  });

  return { resultsDir };
}

async function dispatchTask(
  runtime: EvalRuntimeHandle,
  task: LoadedEvalTask,
  dependencies: RunIdentityEvalDependencies,
): Promise<EvalTaskResult> {
  const judge = { llmJudgeComplete: dependencies.llmJudgeComplete };
  switch (task.manifest.kind) {
    case 'message':
      return dependencies.runMessageTask(runtime.client, task, judge);
    case 'workstream':
      return dependencies.runWorkstreamTask(runtime.client, task, {
        execDir: runtime.execDir,
        ...judge,
      });
    case 'greenfield':
      return dependencies.runGreenfieldTask(runtime.client, task, {
        execDir: runtime.execDir,
        ...judge,
      });
    case 'repo-patch':
      return dependencies.runRepoPatchTask(runtime.client, task, {
        execDir: runtime.execDir,
        ...judge,
      });
  }
}

function toAttempt(
  result: EvalTaskResult,
  identityName: string,
  identityGitSha: string,
): AttemptRecord {
  const attempt: AttemptRecord = {
    instanceId: result.instanceId,
    repo: identityName,
    baseCommit: identityGitSha,
    outcome: result.outcome,
    durationMs: result.durationMs,
    patchBytes: result.patch?.length ?? 0,
  };
  if (result.messageId) attempt.messageId = result.messageId;
  if (result.usage) attempt.usage = result.usage;
  return attempt;
}

function buildEvalReport(results: EvalTaskResult[]): EvalReport {
  const resolvedIds: string[] = [];
  const unresolvedIds: string[] = [];
  const errorIds: string[] = [];

  for (const result of results) {
    if (result.outcome === 'error') {
      errorIds.push(result.instanceId);
    } else if (result.resolved === true) {
      resolvedIds.push(result.instanceId);
    } else {
      unresolvedIds.push(result.instanceId);
    }
  }

  const completedIds = results
    .filter((result) => result.outcome !== 'error')
    .map((result) => result.instanceId);
  return {
    schema_version: 1,
    total_instances: results.length,
    resolved_instances: resolvedIds.length,
    unresolved_instances: unresolvedIds.length,
    empty_patch_instances: 0,
    error_instances: errorIds.length,
    completed_instances: completedIds.length,
    resolved_ids: resolvedIds,
    unresolved_ids: unresolvedIds,
    empty_patch_ids: [],
    error_ids: errorIds,
    completed_ids: completedIds,
  };
}

async function writeArtifacts(
  resultsDir: string,
  attempts: AttemptRecord[],
  taskResults: EvalTaskResult[],
): Promise<void> {
  await Promise.all([
    writeJson(path.join(resultsDir, 'attempts.json'), attempts),
    writeJson(
      path.join(resultsDir, 'eval-report.json'),
      buildEvalReport(taskResults),
    ),
  ]);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function getIdentityGitSha(identityDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: identityDir,
    });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}
