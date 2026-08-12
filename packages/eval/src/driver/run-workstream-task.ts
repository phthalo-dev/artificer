import type { EvalTaskResult, LoadedEvalTask } from '../types.js';
import { gradeWorkstreamStatus } from '../identity/grade.js';
import type { RuntimeClient } from './client.js';
import { TERMINAL } from './poll.js';

export interface WorkstreamTaskConfig {
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
    if (task.manifest.grade.type !== 'workstream-status') return finish(result);

    const created = await client.createWorkstream({
      title: task.manifest.title,
      goal: task.prompt,
      autostart: true,
    });
    result.messageId = created.messageId;

    const status = await waitForTerminalStatus(client, created.workstreamId, {
      timeoutMs:
        task.manifest.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });

    if (status === undefined) {
      result.outcome = 'timeout';
      result.resolved = false;
    } else {
      result.resolved = gradeWorkstreamStatus(
        status,
        task.manifest.grade.expect,
      );
      result.outcome = result.resolved ? 'submitted' : 'failed';
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
