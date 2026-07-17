import type { Engine } from './engine.js';
import { ScheduleRunner } from './schedule-runner.js';
import type { Store } from '../storage/store.js';

type RunStore = Pick<Store, 'listRuns'>;
type WorkstreamStore = Pick<Store, 'getWorkstream'>;

const TERMINAL_RUN_STATUSES = new Set(['done', 'failed']);
const TERMINAL_WORKSTREAM_STATUSES = new Set(['done', 'failed', 'cancelled']);

export async function communicatorRunTerminal(
  store: RunStore,
  messageId: string,
): Promise<boolean> {
  const runs = (await store.listRuns()).filter(
    (run) => run.originMessageId === messageId,
  );
  return (
    runs.length > 0 &&
    runs.every((run) => TERMINAL_RUN_STATUSES.has(run.status))
  );
}

export async function workstreamTerminal(
  store: WorkstreamStore,
  workstreamId: string,
): Promise<boolean> {
  const workstream = await store.getWorkstream(workstreamId);
  return Boolean(
    workstream && TERMINAL_WORKSTREAM_STATUSES.has(workstream.status),
  );
}

export function createScheduleRunnerForEngine(engine: Engine): ScheduleRunner {
  const runner = new ScheduleRunner({
    nowMs: Date.now,
    receiveMessage: async (content) => {
      const message = await engine.receiveMessage(content);
      return { messageId: message.id };
    },
    createWorkstream: async ({ title, goal }) => {
      const { workstream } = await engine.createDirectWorkstream({
        title,
        goal,
        autostart: true,
      });
      return { workstreamId: workstream.id };
    },
    readState: () => engine.store.readScheduleState(),
    writeState: (state) => engine.store.writeScheduleState(state),
    isCommunicatorRunTerminal: (messageId) =>
      communicatorRunTerminal(engine.store, messageId),
    isWorkstreamTerminal: (workstreamId) =>
      workstreamTerminal(engine.store, workstreamId),
    log: (message) => console.error(`[artificer-runtime] ${message}`),
  });

  engine.attachScheduleRunner(runner);
  engine.reloadSchedules();
  return runner;
}
