import {
  getQuickJS,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten';
import { DEFAULT_CODEMODE_LIMITS } from '../config.js';
import {
  installGuestGlobals,
  installTools,
  resolveResumeDeferreds,
  settlePendingDeferreds,
  type BridgeState,
} from './bridge.js';
import { CodemodeCellStore, type CodemodeCell } from './cells.js';
import {
  CODEMODE_MEMORY_BYTES,
  type CodemodeResult,
  type CodemodeSegmentResult,
  type DiagnosticKind,
  type RunCodemodeOptions,
} from './types.js';

export {
  CODEMODE_MAX_CONCURRENCY,
  CODEMODE_MEMORY_BYTES,
  type CodemodeResult,
  type CodemodeSegmentResult,
  type CodemodeTool,
  type DiagnosticKind,
} from './types.js';

export interface StartCodemodeCellOptions extends RunCodemodeOptions {
  store: CodemodeCellStore;
  runId: string;
}

export interface ResumeCodemodeCellOptions {
  store: CodemodeCellStore;
  runId: string;
  cellId: string;
  /** Soft budget for this segment only. Omitted means run to completion. */
  yieldTimeMs?: number;
  /** Dispose the cell instead of running another segment. */
  terminate?: boolean;
}

function guestMessage(vm: QuickJSContext, handle: QuickJSHandle): string {
  const dumped = vm.dump(handle);
  if (dumped && typeof dumped === 'object' && 'message' in dumped) {
    return String((dumped as { message: unknown }).message);
  }
  return String(dumped);
}

function nameUnknownTool(
  message: string,
  code: string,
  tools: RunCodemodeOptions['tools'],
): string {
  if (message !== 'not a function') return message;
  const installed = new Set(tools.map((tool) => tool.name));
  const referenced = code.matchAll(/\btools\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g);
  for (const match of referenced) {
    const name = match[1];
    if (name && !installed.has(name)) return `unknown tool: ${name}`;
  }
  return message;
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'function') {
    throw new Error('result is not JSON-safe');
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error('result is not JSON-safe');
  }
}

function assertGuestJsonSafe(vm: QuickJSContext, value: QuickJSHandle): void {
  const json = vm.getProp(vm.global, 'JSON');
  const stringify = vm.getProp(json, 'stringify');
  const result = vm.callFunction(stringify, json, value);
  stringify.dispose();
  json.dispose();
  if (result.error) {
    const message = guestMessage(vm, result.error);
    result.error.dispose();
    throw new Error(message);
  }
  result.value.dispose();
}

/** What a segment accumulated, echoed on every payload the cell produces. */
interface SegmentOutput {
  logs: string[];
  notifications: string[];
  toolCalls: string[];
}

/** Read-only placeholder for failures raised before a cell exists. */
const NO_OUTPUT: SegmentOutput = { logs: [], notifications: [], toolCalls: [] };

const TRUNCATION_MARKER = '\n(truncated)';

function encodedBytes(
  head: Record<string, unknown>,
  logs: string[],
  notifications: string[],
): number {
  const payload: Record<string, unknown> = { ...head, logs };
  if (notifications.length > 0) payload.notifications = notifications;
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

/** Longest prefix of `items` that still fits the budget. */
function keptPrefix(
  items: string[],
  fits: (candidate: string[]) => boolean,
): string[] {
  const kept: string[] = [];
  for (const item of items) {
    const candidate = [...kept, item];
    if (!fits(candidate)) break;
    kept.push(item);
  }
  return kept;
}

/** Largest prefix of `serialized` whose encoding still fits the budget. */
function keptSerializedLength(
  serialized: string[],
  fits: (candidate: string) => boolean,
): number {
  let low = 0;
  let high = serialized.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(serialized.slice(0, middle).join('') + TRUNCATION_MARKER)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function applyOutputBudget(
  value: unknown,
  logs: string[],
  notifications: string[],
  maxOutputBytes: number,
): {
  value: unknown;
  logs?: string[];
  notifications?: string[];
  truncated?: true;
} {
  const size = (v: unknown, l: string[], n: string[]) =>
    encodedBytes({ value: v }, l, n);

  if (size(value, logs, notifications) <= maxOutputBytes) {
    return {
      value,
      ...(logs.length > 0 ? { logs } : {}),
      ...(notifications.length > 0 ? { notifications } : {}),
    };
  }

  const keptNotifications = keptPrefix(
    notifications,
    (n) => size(TRUNCATION_MARKER, [], n) <= maxOutputBytes,
  );
  const keptLogs = keptPrefix(
    logs,
    (l) => size(TRUNCATION_MARKER, l, keptNotifications) <= maxOutputBytes,
  );
  const serialized = Array.from(JSON.stringify(value) ?? 'null');
  const kept = keptSerializedLength(
    serialized,
    (candidate) =>
      size(candidate, keptLogs, keptNotifications) <= maxOutputBytes,
  );

  return {
    value: serialized.slice(0, kept).join('') + TRUNCATION_MARKER,
    logs: keptLogs,
    ...(keptNotifications.length > 0
      ? { notifications: keptNotifications }
      : {}),
    truncated: true,
  };
}

function applyFailureOutputBudget(
  kind: DiagnosticKind,
  message: string,
  logs: string[],
  notifications: string[],
  maxOutputBytes: number,
): {
  error: { kind: DiagnosticKind; message: string };
  logs?: string[];
  notifications?: string[];
  truncated?: true;
} {
  const size = (m: string, l: string[], n: string[]) =>
    encodedBytes({ error: { kind, message: m } }, l, n);

  if (size(message, logs, notifications) <= maxOutputBytes) {
    return {
      error: { kind, message },
      ...(logs.length > 0 ? { logs } : {}),
      ...(notifications.length > 0 ? { notifications } : {}),
    };
  }

  const keptNotifications = keptPrefix(
    notifications,
    (n) => size(TRUNCATION_MARKER, [], n) <= maxOutputBytes,
  );
  const keptLogs = keptPrefix(
    logs,
    (l) => size(TRUNCATION_MARKER, l, keptNotifications) <= maxOutputBytes,
  );
  const serialized = Array.from(message);
  const kept = keptSerializedLength(
    serialized,
    (candidate) =>
      size(candidate, keptLogs, keptNotifications) <= maxOutputBytes,
  );

  return {
    error: {
      kind,
      message: serialized.slice(0, kept).join('') + TRUNCATION_MARKER,
    },
    logs: keptLogs,
    ...(keptNotifications.length > 0
      ? { notifications: keptNotifications }
      : {}),
    truncated: true,
  };
}

function failedSegment(
  kind: DiagnosticKind,
  message: string,
  output: SegmentOutput,
  maxOutputBytes: number,
  cellId?: string,
): CodemodeSegmentResult {
  const capped = applyFailureOutputBudget(
    kind,
    message,
    output.logs,
    output.notifications,
    maxOutputBytes,
  );
  return {
    ok: false,
    error: capped.error,
    ...(cellId ? { cellId } : {}),
    ...(capped.logs ? { logs: [...capped.logs] } : {}),
    ...(capped.notifications
      ? { notifications: [...capped.notifications] }
      : {}),
    ...(capped.truncated ? { truncated: true } : {}),
    toolCalls: [...output.toolCalls],
  };
}

function completedSegment(
  cell: CodemodeCell,
  value: unknown,
): CodemodeSegmentResult {
  const capped = applyOutputBudget(
    value,
    cell.logs,
    cell.notifications,
    cell.limits.maxOutputBytes,
  );
  return {
    ok: true,
    running: false,
    value: capped.value,
    ...(capped.logs ? { logs: [...capped.logs] } : {}),
    ...(capped.notifications
      ? { notifications: [...capped.notifications] }
      : {}),
    ...(capped.truncated ? { truncated: true } : {}),
    toolCalls: [...cell.state.toolCalls],
  };
}

function runningSegment(cell: CodemodeCell): CodemodeSegmentResult {
  const capped = applyOutputBudget(
    null,
    cell.logs,
    cell.notifications,
    cell.limits.maxOutputBytes,
  );
  return {
    ok: true,
    running: true,
    cellId: cell.id,
    ...(capped.logs ? { logs: [...capped.logs] } : {}),
    ...(capped.notifications
      ? { notifications: [...capped.notifications] }
      : {}),
    ...(capped.truncated ? { truncated: true } : {}),
    toolCalls: [...cell.state.toolCalls],
  };
}

function outputOf(cell: CodemodeCell): SegmentOutput {
  return {
    logs: cell.logs,
    notifications: cell.notifications,
    toolCalls: cell.state.toolCalls,
  };
}

const PRAGMA_PATTERN = /^\/\/\s*@exec:\s*(.*)$/;

interface ExecPragma {
  /** Soft budget for the first segment only. */
  yieldTimeMs?: number;
}

/**
 * Read the optional `// @exec: {"yield_time_ms": N}` first line. Unknown keys
 * are ignored; malformed JSON is a `ParseError` before the program runs.
 */
function parseExecPragma(
  code: string,
): { ok: true; pragma: ExecPragma } | { ok: false; message: string } {
  const lines = code.split('\n');
  const first = lines.find((line) => line.trim() !== '')?.trim();
  const match = first ? PRAGMA_PATTERN.exec(first) : undefined;
  if (!match) return { ok: true, pragma: {} };

  const body = match[1]?.trim() ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, message: `invalid @exec pragma: ${body}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: `invalid @exec pragma: ${body}` };
  }

  const raw = (parsed as Record<string, unknown>).yield_time_ms;
  const usable = typeof raw === 'number' && Number.isFinite(raw) && raw > 0;
  return { ok: true, pragma: usable ? { yieldTimeMs: raw } : {} };
}

type SegmentOutcome =
  | { status: 'completed'; value: QuickJSHandle }
  | { status: 'rejected'; error: QuickJSHandle }
  | { status: 'exited' }
  | { status: 'yielded' }
  | { status: 'fail'; kind: DiagnosticKind; message: string };

/**
 * Drive the guest until it settles, asks to pause, or runs out of budget.
 *
 * Deliberately polls `getPromiseState` instead of `resolvePromise()`: that API
 * creates a host Promise settled only by WASM `.then` callbacks, so timing out
 * and disposing the VM makes Node's test runner report "Promise resolution is
 * still pending but the event loop has already resolved" and fail every
 * subsequent test file in the same process.
 */
async function runSegment(
  cell: CodemodeCell,
  yieldTimeMs?: number,
): Promise<SegmentOutcome> {
  const { vm, state } = cell;
  const runtime = vm.runtime;
  const softDeadline =
    yieldTimeMs === undefined ? undefined : Date.now() + yieldTimeMs;

  let notify: (() => void) | undefined;
  state.kick = () => notify?.();

  const waitForHost = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        notify = undefined;
        resolve();
      }, ms);
      notify = () => {
        clearTimeout(timer);
        notify = undefined;
        resolve();
      };
    });

  try {
    for (;;) {
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        const message = guestMessage(vm, jobs.error);
        jobs.dispose();
        const interrupted = /interrupted/i.test(message);
        return {
          status: 'fail',
          kind: interrupted ? 'TimeoutExceeded' : 'ExecutionFailure',
          message: interrupted ? 'timeoutMs exceeded' : message,
        };
      }
      jobs.dispose();

      if (state.exitRequested) return { status: 'exited' };

      const promise = vm.getPromiseState(cell.promise);
      if (promise.type === 'fulfilled') {
        return { status: 'completed', value: promise.value };
      }
      if (promise.type === 'rejected') {
        return { status: 'rejected', error: promise.error };
      }

      // The hard ceiling outranks a pause request so a guest that yields in a
      // loop cannot outlive `timeoutMs`.
      const now = Date.now();
      if (now >= cell.deadlineAt) {
        return {
          status: 'fail',
          kind: 'TimeoutExceeded',
          message: 'timeoutMs exceeded',
        };
      }
      if (state.yieldRequested) return { status: 'yielded' };
      if (softDeadline !== undefined && now >= softDeadline) {
        return { status: 'yielded' };
      }

      if (runtime.hasPendingJob()) continue;
      const remaining = Math.min(
        cell.deadlineAt - now,
        softDeadline === undefined
          ? Number.POSITIVE_INFINITY
          : softDeadline - now,
      );
      await waitForHost(Math.min(10, remaining));
    }
  } finally {
    notify = undefined;
    state.kick = undefined;
  }
}

/**
 * Turn a segment outcome into a payload. Every outcome except `yielded` is
 * terminal, so the cell is disposed and its slot freed.
 */
function settleSegment(
  store: CodemodeCellStore,
  cell: CodemodeCell,
  outcome: SegmentOutcome,
): CodemodeSegmentResult {
  const { vm, limits, state } = cell;

  // A breached hard limit leaves the cell unresumable, so a pause request must
  // not hand a cellId back to the caller.
  const settled: SegmentOutcome =
    outcome.status === 'yielded' && state.fatal
      ? { status: 'fail', ...state.fatal }
      : outcome;
  if (settled.status === 'yielded') return runningSegment(cell);

  const output = outputOf(cell);
  const fail = (kind: DiagnosticKind, message: string) =>
    failedSegment(kind, message, output, limits.maxOutputBytes, cell.id);

  try {
    if (settled.status === 'fail') return fail(settled.kind, settled.message);

    if (state.fatal) {
      if (settled.status === 'completed') settled.value.dispose();
      if (settled.status === 'rejected') settled.error.dispose();
      return fail(state.fatal.kind, state.fatal.message);
    }

    if (settled.status === 'exited') return completedSegment(cell, null);

    if (settled.status === 'rejected') {
      const message = nameUnknownTool(
        guestMessage(vm, settled.error),
        cell.code,
        cell.tools,
      );
      settled.error.dispose();
      if (/interrupted/i.test(message)) {
        return fail('TimeoutExceeded', 'timeoutMs exceeded');
      }
      // A JSON-safe boundary throw the guest chose not to catch keeps its own
      // diagnostic instead of collapsing into ExecutionFailure.
      const kind = state.dataViolations?.has(message)
        ? 'InvalidDataValue'
        : 'ExecutionFailure';
      return fail(kind, message);
    }

    if (vm.typeof(settled.value) === 'function') {
      settled.value.dispose();
      return fail('InvalidDataValue', 'result is not JSON-safe');
    }
    try {
      assertGuestJsonSafe(vm, settled.value);
    } catch {
      settled.value.dispose();
      return fail('InvalidDataValue', 'result is not JSON-safe');
    }

    const raw = vm.dump(settled.value);
    settled.value.dispose();
    try {
      return completedSegment(cell, jsonSafe(raw));
    } catch (err) {
      return fail(
        'InvalidDataValue',
        err instanceof Error ? err.message : String(err),
      );
    }
  } finally {
    store.disposeCell(cell.runId, cell.id);
  }
}

/**
 * Run one segment and turn it into a payload, keeping the isolate accounted for
 * even when the host throws.
 *
 * The reachable case is a run-end `store.disposeRun` landing while a segment is
 * mid-flight: the cell is freed underneath us and the next
 * `executePendingJobs` / `getPromiseState` is a use-after-free. Callers get a
 * typed failure instead of a rejected Promise, and the cell is unregistered so
 * a dead isolate cannot linger until the next `admit` sweeps it.
 */
async function driveSegment(
  store: CodemodeCellStore,
  cell: CodemodeCell,
  yieldTimeMs?: number,
): Promise<CodemodeSegmentResult> {
  cell.busy = true;
  try {
    return settleSegment(store, cell, await runSegment(cell, yieldTimeMs));
  } catch (err) {
    // `settleSegment` disposes on every terminal outcome and must not dispose on
    // a yield, so this catch is the only place left that can leak a cell.
    store.disposeCell(cell.runId, cell.id);
    const message = err instanceof Error ? err.message : String(err);
    const interrupted = /interrupted/i.test(message);
    return failedSegment(
      interrupted ? 'TimeoutExceeded' : 'ExecutionFailure',
      interrupted ? 'timeoutMs exceeded' : message,
      outputOf(cell),
      cell.limits.maxOutputBytes,
      cell.id,
    );
  } finally {
    cell.busy = false;
  }
}

type CellInit =
  | { ok: true; cell: CodemodeCell }
  | {
      ok: false;
      kind: DiagnosticKind;
      message: string;
      output: SegmentOutput;
    };

/**
 * Build the isolate and start the guest program. Evaluating the async IIFE runs
 * the body up to its first `await`, so this can already fail or log.
 */
function createCell(
  QuickJS: QuickJSWASMModule,
  cellId: string,
  opts: StartCodemodeCellOptions,
): CellInit {
  const { limits } = opts;
  const createdAt = Date.now();
  const deadlineAt = createdAt + limits.timeoutMs;
  const runtime = QuickJS.newRuntime();
  const vm = runtime.newContext();
  const logs: string[] = [];
  const notifications: string[] = [];
  const state: BridgeState = {
    disposed: false,
    toolCalls: [],
    admitted: 0,
    onToolCall: opts.onToolCall,
  };

  let tornDown = false;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    state.disposed = true;
    state.kick = undefined;
    settlePendingDeferreds(vm, state);
    vm.dispose();
    runtime.dispose();
  };

  try {
    runtime.setMemoryLimit(CODEMODE_MEMORY_BYTES);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadlineAt));

    const consoleHandle = vm.newObject();
    for (const method of ['log', 'warn', 'error'] as const) {
      const fn = vm.newFunction(method, (...args) => {
        logs.push(args.map((handle) => String(vm.dump(handle))).join(' '));
        return vm.undefined;
      });
      vm.setProp(consoleHandle, method, fn);
      fn.dispose();
    }
    vm.setProp(vm.global, 'console', consoleHandle);
    consoleHandle.dispose();

    const toolsHandle = installTools(vm, opts.tools, limits, state);
    vm.setProp(vm.global, 'tools', toolsHandle);
    toolsHandle.dispose();

    installGuestGlobals(vm, state, {
      kv: opts.store.kv(opts.runId),
      notifications,
    });

    const evalResult = vm.evalCode(`(async () => {\n${opts.code}\n})()`);
    if (evalResult.error) {
      const message = guestMessage(vm, evalResult.error);
      evalResult.error.dispose();
      const interrupted = /interrupted/i.test(message);
      const output = { logs, notifications, toolCalls: state.toolCalls };
      teardown();
      return {
        ok: false,
        kind: interrupted ? 'TimeoutExceeded' : 'ParseError',
        message: interrupted ? 'timeoutMs exceeded' : message,
        output,
      };
    }
    const promise = vm.unwrapResult(evalResult);

    const cell: CodemodeCell = {
      id: cellId,
      runId: opts.runId,
      createdAt,
      deadlineAt,
      code: opts.code,
      tools: opts.tools,
      limits,
      busy: false,
      logs,
      notifications,
      state,
      vm,
      promise,
      dispose: () => {
        try {
          if (promise.alive) promise.dispose();
        } catch {
          // VM may already be tearing down.
        }
        teardown();
      },
    };
    return { ok: true, cell };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const interrupted = /interrupted/i.test(message);
    const output = { logs, notifications, toolCalls: state.toolCalls };
    teardown();
    return {
      ok: false,
      kind: interrupted ? 'TimeoutExceeded' : 'ExecutionFailure',
      message: interrupted ? 'timeoutMs exceeded' : message,
      output,
    };
  }
}

/**
 * Start a cell and run its first segment. Returns `running: true` with a
 * `cellId` when the guest paused; the isolate stays alive in `store` until
 * `resumeCodemodeCell` finishes it, the run ends, or the TTL sweeps it.
 */
export async function startCodemodeCell(
  opts: StartCodemodeCellOptions,
): Promise<CodemodeSegmentResult> {
  const { limits, store, runId } = opts;
  if (!opts.code.trim()) {
    return failedSegment(
      'ParseError',
      'code is empty',
      NO_OUTPUT,
      limits.maxOutputBytes,
    );
  }

  const pragma = parseExecPragma(opts.code);
  if (!pragma.ok) {
    return failedSegment(
      'ParseError',
      pragma.message,
      NO_OUTPUT,
      limits.maxOutputBytes,
    );
  }

  const QuickJS = await getQuickJS();

  // admit -> createCell -> register stays synchronous so two concurrent starts
  // cannot both claim the last slot.
  const cellId = store.admit(runId);
  if (cellId === undefined) {
    return failedSegment(
      'CellLimitExceeded',
      `maxCells (${limits.maxCells}) exceeded`,
      NO_OUTPUT,
      limits.maxOutputBytes,
    );
  }

  const init = createCell(QuickJS, cellId, opts);
  if (!init.ok) {
    return failedSegment(
      init.kind,
      init.message,
      init.output,
      limits.maxOutputBytes,
    );
  }
  // `driveSegment` claims the cell before its first `await`, so registering it
  // here cannot expose an unclaimed cell to a concurrent resume.
  store.register(init.cell);
  return driveSegment(store, init.cell, pragma.pragma.yieldTimeMs);
}

/**
 * Run another segment of a paused cell. In-flight host tool handlers kept
 * running between segments; the segment loop drains their guest jobs.
 */
export async function resumeCodemodeCell(
  opts: ResumeCodemodeCellOptions,
): Promise<CodemodeSegmentResult> {
  const { store, runId, cellId } = opts;
  const cell = store.get(runId, cellId);
  if (!cell) {
    return failedSegment(
      'CellNotFound',
      `no live codemode cell ${cellId}`,
      NO_OUTPUT,
      DEFAULT_CODEMODE_LIMITS.maxOutputBytes,
    );
  }

  const maxOutputBytes = cell.limits.maxOutputBytes;
  // Terminating is refused too: disposing under a live segment is the same
  // use-after-free, and the in-flight segment is already capped by `deadlineAt`.
  if (cell.busy) {
    return failedSegment(
      'ExecutionFailure',
      `codemode cell ${cellId} is already running a segment`,
      outputOf(cell),
      maxOutputBytes,
      cellId,
    );
  }

  if (opts.terminate) {
    const payload = completedSegment(cell, null);
    store.disposeCell(runId, cellId);
    return payload;
  }

  const now = Date.now();
  if (now >= cell.deadlineAt) {
    const payload = failedSegment(
      'TimeoutExceeded',
      'timeoutMs exceeded',
      outputOf(cell),
      maxOutputBytes,
      cellId,
    );
    store.disposeCell(runId, cellId);
    return payload;
  }
  if (now - cell.createdAt >= store.cellTtlMs) {
    store.disposeCell(runId, cellId);
    return failedSegment(
      'CellNotFound',
      `codemode cell ${cellId} expired before it was resumed`,
      NO_OUTPUT,
      maxOutputBytes,
    );
  }

  cell.state.yieldRequested = false;
  resolveResumeDeferreds(cell.state);
  return driveSegment(store, cell, opts.yieldTimeMs);
}

/** The fields a segment payload and a v1 result share verbatim. */
function envelope(segment: CodemodeSegmentResult) {
  return {
    ...(segment.logs ? { logs: segment.logs } : {}),
    ...(segment.notifications ? { notifications: segment.notifications } : {}),
    ...(segment.truncated ? { truncated: true as const } : {}),
    toolCalls: segment.toolCalls,
  };
}

/**
 * One-shot v1 entry point: an ephemeral store, and yields driven straight
 * through to completion because the caller has no way to resume.
 */
export async function runCodemode(
  opts: RunCodemodeOptions,
): Promise<CodemodeResult> {
  const store = new CodemodeCellStore({
    maxCells: 1,
    cellTtlMs: opts.limits.timeoutMs,
  });
  const runId = 'codemode-one-shot';

  try {
    let segment = await startCodemodeCell({ ...opts, store, runId });
    for (;;) {
      if (!segment.ok) {
        return { ok: false, error: segment.error, ...envelope(segment) };
      }
      if (!segment.running) {
        return { ok: true, value: segment.value, ...envelope(segment) };
      }
      segment = await resumeCodemodeCell({
        store,
        runId,
        cellId: segment.cellId,
      });
    }
  } finally {
    store.disposeRun(runId);
  }
}
