import {
  getQuickJS,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
} from 'quickjs-emscripten';
import { installTools, type BridgeState } from './bridge.js';
import {
  CODEMODE_MEMORY_BYTES,
  type CodemodeResult,
  type DiagnosticKind,
  type RunCodemodeOptions,
} from './types.js';

export {
  CODEMODE_MAX_CONCURRENCY,
  CODEMODE_MEMORY_BYTES,
  type CodemodeResult,
  type CodemodeTool,
  type DiagnosticKind,
} from './types.js';

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
  const referenced = code.matchAll(
    /\btools\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
  );
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

function assertGuestJsonSafe(
  vm: QuickJSContext,
  value: QuickJSHandle,
): void {
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

function applyOutputBudget(
  value: unknown,
  logs: string[],
  maxOutputBytes: number,
): { value: unknown; logs?: string[]; truncated?: true } {
  const encodedBytes = (candidateValue: unknown, candidateLogs: string[]) =>
    Buffer.byteLength(
      JSON.stringify({ value: candidateValue, logs: candidateLogs }),
      'utf8',
    );

  if (encodedBytes(value, logs) <= maxOutputBytes) {
    return logs.length > 0 ? { value, logs } : { value };
  }

  const marker = '\n(truncated)';
  const keptLogs: string[] = [];
  for (const log of logs) {
    const candidateLogs = [...keptLogs, log];
    if (encodedBytes(marker, candidateLogs) > maxOutputBytes) break;
    keptLogs.push(log);
  }

  const serialized = Array.from(JSON.stringify(value));
  let low = 0;
  let high = serialized.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = serialized.slice(0, middle).join('') + marker;
    if (encodedBytes(candidate, keptLogs) <= maxOutputBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return {
    value: serialized.slice(0, low).join('') + marker,
    logs: keptLogs,
    truncated: true,
  };
}

function applyFailureOutputBudget(
  kind: DiagnosticKind,
  message: string,
  logs: string[],
  maxOutputBytes: number,
): {
  error: { kind: DiagnosticKind; message: string };
  logs?: string[];
  truncated?: true;
} {
  const encodedBytes = (candidateMessage: string, candidateLogs: string[]) =>
    Buffer.byteLength(
      JSON.stringify({
        error: { kind, message: candidateMessage },
        logs: candidateLogs,
      }),
      'utf8',
    );

  if (encodedBytes(message, logs) <= maxOutputBytes) {
    return logs.length > 0
      ? { error: { kind, message }, logs }
      : { error: { kind, message } };
  }

  const marker = '\n(truncated)';
  const keptLogs: string[] = [];
  for (const log of logs) {
    const candidateLogs = [...keptLogs, log];
    if (encodedBytes(marker, candidateLogs) > maxOutputBytes) break;
    keptLogs.push(log);
  }

  const serialized = Array.from(message);
  let low = 0;
  let high = serialized.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = serialized.slice(0, middle).join('') + marker;
    if (encodedBytes(candidate, keptLogs) <= maxOutputBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return {
    error: {
      kind,
      message: serialized.slice(0, low).join('') + marker,
    },
    logs: keptLogs,
    truncated: true,
  };
}

function failure(
  kind: DiagnosticKind,
  message: string,
  logs: string[],
  toolCalls: string[],
  maxOutputBytes: number,
): CodemodeResult {
  const capped = applyFailureOutputBudget(
    kind,
    message,
    logs,
    maxOutputBytes,
  );
  return {
    ok: false,
    error: capped.error,
    ...(capped.logs ? { logs: capped.logs } : {}),
    ...(capped.truncated ? { truncated: true } : {}),
    toolCalls,
  };
}

export async function runCodemode(
  opts: RunCodemodeOptions,
): Promise<CodemodeResult> {
  if (!opts.code.trim()) {
    return failure(
      'ParseError',
      'code is empty',
      [],
      [],
      opts.limits.maxOutputBytes,
    );
  }

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  const vm = runtime.newContext();
  const logs: string[] = [];
  const state: BridgeState = {
    disposed: false,
    toolCalls: [],
    admitted: 0,
    onToolCall: opts.onToolCall,
  };
  const deadline = Date.now() + opts.limits.timeoutMs;

  try {
    runtime.setMemoryLimit(CODEMODE_MEMORY_BYTES);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

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

    const toolsHandle = installTools(vm, opts.tools, opts.limits, state);
    vm.setProp(vm.global, 'tools', toolsHandle);
    toolsHandle.dispose();

    const evalResult = vm.evalCode(`(async () => {\n${opts.code}\n})()`);
    if (evalResult.error) {
      const message = guestMessage(vm, evalResult.error);
      evalResult.error.dispose();
      const interrupted = /interrupted/i.test(message);
      return failure(
        interrupted ? 'TimeoutExceeded' : 'ParseError',
        interrupted ? 'timeoutMs exceeded' : message,
        logs,
        state.toolCalls,
        opts.limits.maxOutputBytes,
      );
    }

    const promiseHandle = vm.unwrapResult(evalResult);
    const resolution = vm.resolvePromise(promiseHandle);
    promiseHandle.dispose();

    const jobs = runtime.executePendingJobs();
    if (jobs.error) {
      const message = guestMessage(vm, jobs.error);
      jobs.error.dispose();
      const interrupted = /interrupted/i.test(message);
      return failure(
        interrupted ? 'TimeoutExceeded' : 'ExecutionFailure',
        interrupted ? 'timeoutMs exceeded' : message,
        logs,
        state.toolCalls,
        opts.limits.maxOutputBytes,
      );
    }

    const timeout = Symbol('timeout');
    const remaining = Math.max(0, deadline - Date.now());
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<typeof timeout>((resolve) => {
      timer = setTimeout(() => resolve(timeout), remaining);
    });
    const resolved = await Promise.race([resolution, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (resolved === timeout) {
      return failure(
        'TimeoutExceeded',
        'timeoutMs exceeded',
        logs,
        state.toolCalls,
        opts.limits.maxOutputBytes,
      );
    }

    if (state.fatal) {
      if (resolved.error) {
        resolved.error.dispose();
      } else {
        resolved.value.dispose();
      }
      return failure(
        state.fatal.kind,
        state.fatal.message,
        logs,
        state.toolCalls,
        opts.limits.maxOutputBytes,
      );
    }

    if (resolved.error) {
      const message = nameUnknownTool(
        guestMessage(vm, resolved.error),
        opts.code,
        opts.tools,
      );
      resolved.error.dispose();
      const interrupted = /interrupted/i.test(message);
      return failure(
        interrupted ? 'TimeoutExceeded' : 'ExecutionFailure',
        interrupted ? 'timeoutMs exceeded' : message,
        logs,
        state.toolCalls,
        opts.limits.maxOutputBytes,
      );
    }

    if (vm.typeof(resolved.value) === 'function') {
      resolved.value.dispose();
      return failure(
        'InvalidDataValue',
        'result is not JSON-safe',
        logs,
        state.toolCalls,
        opts.limits.maxOutputBytes,
      );
    }

    try {
      assertGuestJsonSafe(vm, resolved.value);
    } catch {
      resolved.value.dispose();
      return failure(
        'InvalidDataValue',
        'result is not JSON-safe',
        logs,
        state.toolCalls,
        opts.limits.maxOutputBytes,
      );
    }

    const raw = vm.dump(resolved.value);
    resolved.value.dispose();
    let value: unknown;
    try {
      value = jsonSafe(raw);
    } catch (err) {
      return failure(
        'InvalidDataValue',
        err instanceof Error ? err.message : String(err),
        logs,
        state.toolCalls,
        opts.limits.maxOutputBytes,
      );
    }

    const capped = applyOutputBudget(value, logs, opts.limits.maxOutputBytes);
    return {
      ok: true,
      value: capped.value,
      ...(capped.logs ? { logs: capped.logs } : {}),
      ...(capped.truncated ? { truncated: true } : {}),
      toolCalls: state.toolCalls,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind: DiagnosticKind = /interrupted/i.test(message)
      ? 'TimeoutExceeded'
      : 'ExecutionFailure';
    return failure(
      kind,
      kind === 'TimeoutExceeded' ? 'timeoutMs exceeded' : message,
      logs,
      state.toolCalls,
      opts.limits.maxOutputBytes,
    );
  } finally {
    state.disposed = true;
    for (const deferred of state.pending ?? []) {
      deferred.dispose();
    }
    vm.dispose();
    runtime.dispose();
  }
}
