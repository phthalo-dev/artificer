import { RuntimeClient } from '@artificer/agent-gateway';
import type { WakeService } from './wake.js';

export interface IdleMonitorConfig {
  runtimeUrl: string;
  runtimeAuthToken?: string;
  /** Stop the host after this many ms of idle runtime state. */
  idleMs: number;
  /** How often to check runtime state. */
  pollIntervalMs?: number;
  wakeService?: WakeService;
}

export class IdleMonitor {
  private runtime: RuntimeClient;
  private idleMs: number;
  private pollIntervalMs: number;
  private wakeService?: WakeService;
  private idleSince: number | undefined;
  private running = false;

  constructor(config: IdleMonitorConfig) {
    this.runtime = new RuntimeClient({
      baseUrl: config.runtimeUrl,
      authToken: config.runtimeAuthToken,
    });
    this.idleMs = config.idleMs;
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000;
    this.wakeService = config.wakeService;
  }

  /** Start the idle polling loop. Resolves when stop() is called. */
  async run(): Promise<void> {
    this.running = true;
    while (this.running) {
      await this.tick();
      await sleep(this.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  private async tick(): Promise<void> {
    try {
      const idle = await this.runtime.isIdle();
      if (!idle) {
        this.idleSince = undefined;
        return;
      }

      this.idleSince ??= Date.now();
      if (Date.now() - this.idleSince < this.idleMs) return;

      console.log(
        `[idle-monitor] runtime idle for ${this.idleMs}ms — hibernating`,
      );
      this.idleSince = undefined;
      await this.wakeService?.hibernate();
      this.stop();
    } catch (err) {
      console.error('[idle-monitor] tick failed:', err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
