import type { LoadedEvalTask, EvalTaskResult } from '../types.js';
import { gradeMessageContains } from '../identity/grade.js';
import type { RuntimeClient } from './client.js';
import { collectOutboundMessages } from './collect-outbound.js';

export interface MessageTaskConfig {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

export async function waitForInboundComplete(
  client: RuntimeClient,
  options: { timeoutMs: number; pollIntervalMs: number },
): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    try {
      const state = await client.getState();
      if (
        !state.busy &&
        state.queue.pending === 0 &&
        state.queue.running === 0
      ) {
        return true;
      }
    } catch {
      // Runtime state may be briefly unavailable; retry until the deadline.
    }
    await sleep(options.pollIntervalMs);
  }

  return false;
}

export async function runMessageTask(
  client: RuntimeClient,
  task: LoadedEvalTask,
  config: MessageTaskConfig = {},
): Promise<EvalTaskResult> {
  const startedAt = Date.now();
  const outbound = await collectOutboundMessages(client.baseUrl);
  let messageId: string | undefined;
  let outcome: EvalTaskResult['outcome'] = 'error';
  let resolved: boolean | undefined;

  try {
    const message = await client.sendMessage(task.prompt);
    messageId = message.id;

    const completed = await waitForInboundComplete(client, {
      timeoutMs:
        task.manifest.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });

    if (!completed) {
      outcome = 'timeout';
      resolved = false;
    } else if (task.manifest.grade.type !== 'message-contains') {
      outcome = 'error';
    } else {
      resolved = gradeMessageContains(
        outbound.messages,
        task.manifest.grade.pattern,
      );
      outcome = resolved ? 'submitted' : 'failed';
    }
  } catch {
    outcome = 'error';
  } finally {
    await outbound.stop();
  }

  const result: EvalTaskResult = {
    instanceId: task.manifest.id,
    outcome,
    durationMs: Date.now() - startedAt,
    outboundMessages: [...outbound.messages],
  };
  if (messageId) {
    result.messageId = messageId;
    const cost = await client.messageCost(messageId).catch(() => undefined);
    if (cost) result.usage = cost.total;
  }
  if (resolved !== undefined) result.resolved = resolved;
  result.durationMs = Date.now() - startedAt;
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
