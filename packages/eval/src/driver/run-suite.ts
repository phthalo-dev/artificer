import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AttemptRecord } from '../bench/types.js';
import { loadEvalSuite } from '../identity/load-suite.js';
import { loadEvalTask } from '../identity/load-task.js';
import type {
  EvalRunOptions,
  EvalTaskResult,
  LoadedEvalTask,
} from '../types.js';
import { runGreenfieldTask } from './run-greenfield-task.js';
import { runMessageTask } from './run-message-task.js';
import { runWorkstreamTask } from './run-workstream-task.js';
import { writeReport } from './report.js';
import { newEvalRunDir, updateLatestSymlink } from './results-paths.js';
import { startEvalRuntime, type EvalRuntimeHandle } from './runtime.js';

const execFileAsync = promisify(execFile);

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
  startEvalRuntime: typeof startEvalRuntime;
  runMessageTask: typeof runMessageTask;
  runWorkstreamTask: typeof runWorkstreamTask;
  runGreenfieldTask: typeof runGreenfieldTask;
  writeReport: typeof writeReport;
  getIdentityGitSha: (identityDir: string) => Promise<string>;
}

const defaultDependencies: RunIdentityEvalDependencies = {
  loadEvalSuite,
  loadEvalTask,
  startEvalRuntime,
  runMessageTask,
  runWorkstreamTask,
  runGreenfieldTask,
  writeReport,
  getIdentityGitSha,
};

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
  const suiteId = options.suiteId ?? 'smoke';
  const runLabel = options.taskId ?? suiteId;
  const resultsDir = path.resolve(
    options.resultsDir ?? newEvalRunDir(execDir, runLabel),
  );
  const identityGitSha = await dependencies.getIdentityGitSha(identityDir);
  const suite = options.taskId
    ? {
        name: options.taskId,
        taskIds: [options.taskId],
      }
    : await dependencies.loadEvalSuite(identityDir, suiteId);

  await fs.mkdir(path.join(resultsDir, 'runs'), { recursive: true });
  const attempts: AttemptRecord[] = [];
  const taskResults: EvalTaskResult[] = [];
  const tasks: LoadedEvalTask[] = [];
  await writeArtifacts(resultsDir, attempts, taskResults);

  let runtime: EvalRuntimeHandle | undefined;
  try {
    runtime = await dependencies.startEvalRuntime({
      identityDir,
      execDir,
      presetId: options.presetId,
    });

    for (const taskId of suite.taskIds) {
      const task = await dependencies.loadEvalTask(identityDir, taskId);
      tasks.push(task);
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
    suiteId: options.taskId ? null : suiteId,
    suiteName: suite.name,
    taskId: options.taskId ?? null,
    taskIds: suite.taskIds,
    presetId: options.presetId ?? null,
    createdAt: new Date().toISOString(),
  });

  return { resultsDir };
}

async function dispatchTask(
  runtime: EvalRuntimeHandle,
  task: LoadedEvalTask,
  dependencies: RunIdentityEvalDependencies,
): Promise<EvalTaskResult> {
  switch (task.manifest.kind) {
    case 'message':
      return dependencies.runMessageTask(runtime.client, task);
    case 'workstream':
      return dependencies.runWorkstreamTask(runtime.client, task);
    case 'greenfield':
      return dependencies.runGreenfieldTask(runtime.client, task, {
        execDir: runtime.execDir,
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
    patchBytes: 0,
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
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: identityDir,
  });
  return stdout.trim();
}
