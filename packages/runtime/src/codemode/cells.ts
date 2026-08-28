export type RunKv = Map<string, unknown>;

export interface CodemodeCell {
  id: string;
  runId: string;
  createdAt: number;
}

interface RunState {
  kv: RunKv;
  cells: Map<string, CodemodeCell>;
}

export class CodemodeCellStore {
  #maxCells: number;
  #cellTtlMs: number;
  #runs = new Map<string, RunState>();

  constructor(opts: { maxCells: number; cellTtlMs: number }) {
    this.#maxCells = opts.maxCells;
    this.#cellTtlMs = opts.cellTtlMs;
  }

  kv(runId: string): RunKv {
    return this.#ensure(runId).kv;
  }

  get(runId: string, cellId: string): CodemodeCell | undefined {
    return this.#runs.get(runId)?.cells.get(cellId);
  }

  disposeRun(runId: string): void {
    this.#runs.delete(runId);
  }

  disposeExpired(now = Date.now()): void {
    for (const run of this.#runs.values()) {
      for (const [cellId, cell] of run.cells) {
        if (now - cell.createdAt >= this.#cellTtlMs) {
          run.cells.delete(cellId);
        }
      }
    }
  }

  #ensure(runId: string): RunState {
    let run = this.#runs.get(runId);
    if (!run) {
      run = { kv: new Map(), cells: new Map() };
      this.#runs.set(runId, run);
    }
    return run;
  }
}
