import path from 'node:path';
import type { EvalTaskResult, LoadedEvalTask } from '../types.js';
import { gradeFileExists, gradeWorkstreamStatus } from '../identity/grade.js';
import type { RuntimeClient } from './client.js';
import { extractPatch } from './extract-patch.js';
import { TERMINAL } from './poll.js';

export interface WorkstreamTaskConfig {
  execDir?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

export async function runWorkstreamTask(
  client: RuntimeClient,
  task: LoadedEvalTask,
  config: WorkstreamTaskConfig = {},
): Promise<EvalTaskResult> {
  const startedAt = Date.now();
  const result: EvalTaskResult = {
    instanceId: task.manifest.id,
    outcome: 'error',
    durationMs: 0,
    outboundMessages: [],
  };

  try {
    const grade = task.manifest.grade;
    if (grade.type !== 'workstream-status' && grade.type !== 'file-exists') {
      return finish(result);
    }

    const createInput: Parameters<RuntimeClient['createWorkstream']>[0] = {
      title: task.manifest.title,
      goal: task.prompt,
      autostart: true,
    };
    if (task.manifest.repo?.url) {
      createInput.repoUrl = task.manifest.repo.url;
    }
    if (task.manifest.repo?.baseCommit) {
      createInput.baseCommit = task.manifest.repo.baseCommit;
    }
    const created = await client.createWorkstream(createInput);
    result.messageId = created.messageId;

    const status = await waitForTerminalStatus(client, created.workstreamId, {
      timeoutMs:
        task.manifest.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });

    if (status === undefined) {
      result.outcome = 'timeout';
      result.resolved = false;
    } else if (grade.type === 'workstream-status') {
      result.resolved = gradeWorkstreamStatus(status, grade.expect);
      result.outcome = result.resolved ? 'submitted' : 'failed';
    } else {
      const execDir = config.execDir;
      if (!execDir) {
        result.outcome = 'error';
        result.resolved = false;
      } else {
        const workspaceDir = path.join(
          execDir,
          'workspace',
          created.workstreamId,
        );
        const baseCommit = task.manifest.repo?.baseCommit ?? 'HEAD';
        const extracted = await extractPatch(workspaceDir, baseCommit);
        const checkDir = extracted.repoDir ?? workspaceDir;
        result.resolved = await gradeFileExists(checkDir, grade.path);
        result.outcome = result.resolved ? 'submitted' : 'failed';
      }
    }
  } catch {
    result.outcome = 'error';
  }

  if (result.messageId) {
    const cost = await client
      .messageCost(result.messageId)
      .catch(() => undefined);
    if (cost) result.usage = cost.total;
  }

  return finish(result);

  function finish(value: EvalTaskResult): EvalTaskResult {
    value.durationMs = Date.now() - startedAt;
    return value;
  }
}

async function waitForTerminalStatus(
  client: RuntimeClient,
  workstreamId: string,
  options: { timeoutMs: number; pollIntervalMs: number },
): Promise<string | undefined> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    try {
      const state = await client.getState();
      const workstream = state.workstreams.find(
        (candidate) => candidate.id === workstreamId,
      );
      if (workstream && TERMINAL.has(workstream.status)) {
        return workstream.status;
      }
    } catch {
      // Runtime state may be briefly unavailable; retry until the deadline.
    }
    await sleep(options.pollIntervalMs);
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
