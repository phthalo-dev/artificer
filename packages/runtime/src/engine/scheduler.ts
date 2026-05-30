/**
 * A tiny async work queue. Runs are identified by id; the engine supplies the
 * executor. Concurrency is bounded so many workstreams can progress without
 * overwhelming the LLM API.
 */
export class Scheduler {
  private readonly queue: string[] = [];
  private active = 0;

  constructor(
    private readonly concurrency: number,
    private readonly execute: (runId: string) => Promise<void>,
  ) {}

  enqueue(runId: string): void {
    this.queue.push(runId);
    queueMicrotask(() => this.pump());
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const runId = this.queue.shift();
      if (!runId) break;
      this.active += 1;
      this.execute(runId)
        .catch(() => {
          /* errors are recorded on the run record by the executor */
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }
}
