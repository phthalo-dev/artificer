import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import type { CodemodeLimits } from '../config.js';
import type { BridgeState } from './bridge.js';
import type { CodemodeSegmentResult, CodemodeTool } from './types.js';

export type RunKv = Map<string, unknown>;

/**
 * A yielded codemode program with its QuickJS isolate still alive. The host
 * keeps every handle needed to run another segment later.
 */
export interface CodemodeCell {
  id: string;
  runId: string;
  createdAt: number;
  /** Hard wall-clock ceiling for the whole cell; resuming does not extend it. */
  deadlineAt: number;
  /** Source as submitted, used to name unknown tools in failures. */
  code: string;
  tools: CodemodeTool[];
  limits: CodemodeLimits;
  /**
   * True while a host segment is driving this cell. The store hands out a
   * resumable id, so this is the only mutual exclusion stopping two overlapping
   * resumes from polling and disposing the same isolate.
   */
  busy: boolean;
  /** Cumulative for the cell's whole lifetime, not per segment. */
  logs: string[];
  notifications: string[];
  state: BridgeState;
  vm: QuickJSContext;
  /** The guest async IIFE promise, polled once per host loop turn. */
  promise: QuickJSHandle;
  /** Tears the isolate down. Idempotent. */
  dispose: () => void;
}

interface RunState {
  kv: RunKv;
  cells: Map<string, CodemodeCell>;
  /**
   * Terminal payloads kept after the isolate is freed so a later wait still
   * sees the result. These do not count toward maxCells.
   */
  completed: Map<string, CodemodeSegmentResult>;
}

export class CodemodeCellStore {
  #maxCells: number;
  #cellTtlMs: number;
  #runs = new Map<string, RunState>();
  #nextCellId = 0;

  constructor(opts: { maxCells: number; cellTtlMs: number }) {
    this.#maxCells = opts.maxCells;
    this.#cellTtlMs = opts.cellTtlMs;
  }

  /** How long a cell may sit between segments before it is swept. */
  get cellTtlMs(): number {
    return this.#cellTtlMs;
  }

  kv(runId: string): RunKv {
    return this.#ensure(runId).kv;
  }

  get(runId: string, cellId: string): CodemodeCell | undefined {
    return this.#runs.get(runId)?.cells.get(cellId);
  }

  /**
   * Claim a cell id when the run has room, sweeping expired cells first.
   * Returns undefined once `maxCells` cells are alive for the run.
   *
   * Callers must `register` the built cell in the same synchronous block, or
   * two concurrent starts can both claim the last slot.
   */
  admit(runId: string, now = Date.now()): string | undefined {
    this.disposeExpired(now);
    const run = this.#ensure(runId);
    if (run.cells.size >= this.#maxCells) return undefined;
    this.#nextCellId += 1;
    return `cell-${this.#nextCellId}`;
  }

  /** Take ownership of a cell built against an `admit`ed id. */
  register(cell: CodemodeCell): void {
    this.#ensure(cell.runId).cells.set(cell.id, cell);
  }

  disposeCell(runId: string, cellId: string): void {
    const run = this.#runs.get(runId);
    const cell = run?.cells.get(cellId);
    if (!run || !cell) return;
    run.cells.delete(cellId);
    cell.dispose();
  }

  /**
   * Remember a terminal payload after the isolate is gone. No-op if the run
   * has already been disposed (a concurrent `disposeRun`).
   */
  cacheCompleted(
    runId: string,
    cellId: string,
    payload: CodemodeSegmentResult,
  ): void {
    const run = this.#runs.get(runId);
    if (!run) return;
    run.completed.set(cellId, payload);
  }

  getCompleted(
    runId: string,
    cellId: string,
  ): CodemodeSegmentResult | undefined {
    return this.#runs.get(runId)?.completed.get(cellId);
  }

  forgetCompleted(runId: string, cellId: string): void {
    this.#runs.get(runId)?.completed.delete(cellId);
  }

  disposeRun(runId: string): void {
    const run = this.#runs.get(runId);
    this.#runs.delete(runId);
    if (!run) return;
    for (const cell of run.cells.values()) cell.dispose();
    run.cells.clear();
    run.completed.clear();
  }

  disposeExpired(now = Date.now()): void {
    for (const run of this.#runs.values()) {
      for (const [cellId, cell] of run.cells) {
        if (now - cell.createdAt >= this.#cellTtlMs) {
          run.cells.delete(cellId);
          cell.dispose();
        }
      }
    }
  }

  #ensure(runId: string): RunState {
    let run = this.#runs.get(runId);
    if (!run) {
      run = { kv: new Map(), cells: new Map(), completed: new Map() };
      this.#runs.set(runId, run);
    }
    return run;
  }
}
