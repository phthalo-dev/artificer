import path from 'node:path';
import type { EvalTaskResult, LoadedEvalTask } from '../types.js';
import {
  materializeRepoPatch,
  type MaterializedRepoPatch,
} from '../identity/repo-patch-fixture.js';
import { gradeFileExists } from '../identity/grade.js';
import { gradeGreenfieldPatch } from '../identity/grade-greenfield.js';
import type { RuntimeClient } from './client.js';
import { extractPatch } from './extract-patch.js';
import { TERMINAL } from './poll.js';

export interface RepoPatchTaskConfig {
  execDir: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  gradeTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * Runs a `repo-patch` task: materialize/clone pinned repo, optionally apply
 * `introduce-bug.patch`, start a workstream with repo context, extract the
 * agent patch, and grade with the shell grader + hidden tests (or file-exists).
 */
export async function runRepoPatchTask(
  client: RuntimeClient,
  task: LoadedEvalTask,
  config: RepoPatchTaskConfig,
): Promise<EvalTaskResult> {
  const startedAt = Date.now();
  const result: EvalTaskResult = {
    instanceId: task.manifest.id,
    outcome: 'error',
    durationMs: 0,
    outboundMessages: [],
  };
  let fixture: MaterializedRepoPatch | undefined;

  try {
    if (task.manifest.kind !== 'repo-patch' || !task.manifest.repo) {
      return finish(result);
    }

    const grade = task.manifest.grade;
    if (grade.type !== 'shell' && grade.type !== 'file-exists') {
      return finish(result);
    }
    if (grade.type === 'shell' && !task.hiddenDir) {
      return finish(result);
    }

    fixture = await materializeRepoPatch({
      repo: task.manifest.repo,
      fixtureDir: task.fixtureDir,
    });

    const created = await client.createWorkstream({
      title: task.manifest.title,
      goal: task.prompt,
      repoUrl: fixture.repoDir,
      baseCommit: fixture.baseCommit,
      autostart: true,
    });
    result.messageId = created.messageId;

    const completed = await waitForTerminal(
      client,
      created.workstreamId,
      task.manifest.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    if (!completed) {
      result.outcome = 'timeout';
      result.resolved = false;
      return await withUsage(client, result);
    }

    const workspaceDir = path.join(
      config.execDir,
      'workspace',
      created.workstreamId,
    );

    if (grade.type === 'file-exists') {
      const extracted = await extractPatch(workspaceDir, fixture.baseCommit);
      const checkDir = extracted.repoDir ?? workspaceDir;
      result.resolved = await gradeFileExists(checkDir, grade.path);
      result.outcome = result.resolved ? 'submitted' : 'failed';
      return await withUsage(client, result);
    }

    const extracted = await extractPatch(workspaceDir, fixture.baseCommit);
    if (!extracted.patch.trim()) {
      result.outcome = 'failed';
      result.resolved = false;
      return await withUsage(client, result);
    }

    const gradeCwd = grade.cwd ?? task.manifest.repo.subpath;
    result.resolved = await gradeGreenfieldPatch({
      repoDir: fixture.repoDir,
      patch: extracted.patch,
      hiddenDir: task.hiddenDir!,
      command: task.manifest.test_command ?? grade.command,
      cwd: gradeCwd,
      timeoutMs: config.gradeTimeoutMs,
    });
    result.outcome = result.resolved ? 'submitted' : 'failed';
    return await withUsage(client, result);
  } catch {
    result.outcome = 'error';
    return await withUsage(client, result);
  } finally {
    await fixture?.cleanup().catch(() => {});
    finish(result);
  }

  function finish(value: EvalTaskResult): EvalTaskResult {
    value.durationMs = Date.now() - startedAt;
    return value;
  }
}

async function waitForTerminal(
  client: RuntimeClient,
  workstreamId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await client.getState();
      const workstream = state.workstreams.find(
        (candidate) => candidate.id === workstreamId,
      );
      if (workstream && TERMINAL.has(workstream.status)) return true;
    } catch {
      // Runtime state may be briefly unavailable; retry until the deadline.
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

async function withUsage(
  client: RuntimeClient,
  result: EvalTaskResult,
): Promise<EvalTaskResult> {
  if (result.messageId) {
    const cost = await client
      .messageCost(result.messageId)
      .catch(() => undefined);
    if (cost) result.usage = cost.total;
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
