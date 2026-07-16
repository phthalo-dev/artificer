import {
  isScheduleDue,
  type ScheduleDefinition,
  type ScheduleRuntimeState,
} from './schedules.js';

export interface ScheduleFireDeps {
  nowMs: () => number;
  receiveMessage: (content: string) => Promise<{ messageId: string }>;
  createWorkstream: (input: {
    title: string;
    goal: string;
  }) => Promise<{ workstreamId: string }>;
  readState: () => Promise<ScheduleRuntimeState>;
  writeState: (state: ScheduleRuntimeState) => Promise<void>;
  isCommunicatorRunTerminal?: (messageId: string) => Promise<boolean>;
  isWorkstreamTerminal?: (workstreamId: string) => Promise<boolean>;
  log?: (message: string) => void;
}

type InFlightFire =
  | { kind: 'communicator'; messageId: string }
  | { kind: 'workstream'; workstreamId: string };

export class ScheduleRunner {
  private definitions: ScheduleDefinition[] = [];
  private readonly inFlight = new Map<string, InFlightFire>();
  private readonly firing = new Set<string>();
  private runtimeState: ScheduleRuntimeState = { schedules: {} };
  private startedAtMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: ScheduleFireDeps & { pollIntervalMs?: number }) {
    this.startedAtMs = deps.nowMs();
  }

  reload(definitions: ScheduleDefinition[]): void {
    this.definitions = [...definitions];
  }

  list(): Array<ScheduleDefinition & { lastFiredAt: number | null; inFlight: boolean }> {
    return this.definitions.map((definition) => ({
      ...definition,
      lastFiredAt: this.runtimeState.schedules[definition.id]?.lastFiredAt ?? null,
      inFlight: this.inFlight.has(definition.id) || this.firing.has(definition.id),
    }));
  }

  async tick(): Promise<void> {
    await this.clearTerminalFires();
    let state = await this.deps.readState();
    this.runtimeState = state;
    const nowMs = this.deps.nowMs();

    for (const schedule of this.definitions) {
      if (this.inFlight.has(schedule.id) || this.firing.has(schedule.id)) {
        continue;
      }

      const lastFiredAt = state.schedules[schedule.id]?.lastFiredAt ?? null;
      if (
        !isScheduleDue({
          schedule,
          nowMs,
          lastFiredAt,
          startedAtMs: this.startedAtMs,
        })
      ) {
        continue;
      }

      this.firing.add(schedule.id);
      const stampedState = this.withLastFiredAt(state, schedule.id, nowMs);
      try {
        await this.deps.writeState(stampedState);
        state = stampedState;
        this.runtimeState = state;
      } catch (error) {
        this.firing.delete(schedule.id);
        this.logFailure(schedule.id, error);
        continue;
      }

      try {
        const fire = await this.fire(schedule);
        this.inFlight.set(schedule.id, fire);
      } catch (error) {
        const revertedState = this.withLastFiredAt(state, schedule.id, lastFiredAt);
        try {
          await this.deps.writeState(revertedState);
          state = revertedState;
          this.runtimeState = state;
        } catch (revertError) {
          this.logFailure(schedule.id, revertError);
        }
        this.logFailure(schedule.id, error);
      } finally {
        this.firing.delete(schedule.id);
      }
    }
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.startedAtMs = this.deps.nowMs();
    const pollIntervalMs = this.deps.pollIntervalMs ?? 1_000;
    const poll = async (): Promise<void> => {
      try {
        await this.tick();
      } catch (error) {
        this.deps.log?.(
          `Schedule poll failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        if (this.timer) {
          this.timer = setTimeout(() => void poll(), pollIntervalMs);
        }
      }
    };
    this.timer = setTimeout(() => void poll(), pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async clearTerminalFires(): Promise<void> {
    for (const [id, fire] of this.inFlight) {
      try {
        const terminal =
          fire.kind === 'communicator'
            ? await this.deps.isCommunicatorRunTerminal?.(fire.messageId)
            : await this.deps.isWorkstreamTerminal?.(fire.workstreamId);
        if (terminal) {
          this.inFlight.delete(id);
        }
      } catch (error) {
        this.logFailure(id, error);
      }
    }
  }

  private async fire(schedule: ScheduleDefinition): Promise<InFlightFire> {
    if (schedule.action === 'communicator') {
      const { messageId } = await this.deps.receiveMessage(
        `[schedule:${schedule.id}] ${schedule.body}`,
      );
      return { kind: 'communicator', messageId };
    }

    const { workstreamId } = await this.deps.createWorkstream({
      title: schedule.name,
      goal: schedule.body,
    });
    return { kind: 'workstream', workstreamId };
  }

  private withLastFiredAt(
    state: ScheduleRuntimeState,
    id: string,
    lastFiredAt: number | null,
  ): ScheduleRuntimeState {
    const schedules = { ...state.schedules };
    if (lastFiredAt === null) {
      delete schedules[id];
    } else {
      schedules[id] = { lastFiredAt };
    }
    return { ...state, schedules };
  }

  private logFailure(id: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.deps.log?.(`Schedule "${id}" failed: ${message}`);
  }
}
