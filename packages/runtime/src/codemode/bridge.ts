import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSHandle,
} from 'quickjs-emscripten';
import type { ToolInvocation } from '../storage/types.js';
import {
  CODEMODE_MAX_CONCURRENCY,
  type CodemodeTool,
  type DiagnosticKind,
} from './types.js';

export interface BridgeState {
  disposed: boolean;
  toolCalls: string[];
  admitted: number;
  fatal?: { kind: DiagnosticKind; message: string };
  onToolCall?: (invocation: ToolInvocation) => void;
  pending?: Set<QuickJSDeferredPromise>;
  /** Wakes the host wait loop after a tool settles. */
  kick?: () => void;
  /** Set by `yield_control()`; cleared when the host starts the next segment. */
  yieldRequested?: boolean;
  /** Set by `exit()`; the host completes the cell with a null value. */
  exitRequested?: boolean;
  /** Guest promises that pause the turn, resolved when the cell resumes. */
  resumeDeferreds?: QuickJSDeferredPromise[];
  /**
   * Messages thrown at the JSON-safe boundary. These throws are catchable, so
   * this only classifies the diagnostic when one escapes the guest uncaught.
   */
  dataViolations?: Set<string>;
}

/** Host-side state the additive guest globals read and write. */
export interface GuestGlobals {
  /** Run-scoped KV behind `store` / `load`, shared by every cell in the run. */
  kv: Map<string, unknown>;
  /** Cell-local sink behind `notify`. */
  notifications: string[];
}

function executePendingJobs(vm: QuickJSContext): void {
  if (!vm.runtime.alive) return;
  try {
    vm.runtime.executePendingJobs().dispose();
  } catch {
    // VM may already be tearing down.
  }
}

function reject(
  vm: QuickJSContext,
  deferred: QuickJSDeferredPromise,
  message: string,
): void {
  const error = vm.newError(message);
  deferred.reject(error);
  error.dispose();
}

function resolve(
  vm: QuickJSContext,
  deferred: QuickJSDeferredPromise,
  output: string,
): void {
  const value = vm.newString(output);
  deferred.resolve(value);
  value.dispose();
}

/** Reject leftover guest promises so `deferred.settled` does not leak a pending host Promise. */
export function settlePendingDeferreds(
  vm: QuickJSContext,
  state: BridgeState,
): void {
  state.resumeDeferreds?.splice(0);
  const pending = state.pending;
  if (!pending) return;
  for (const deferred of [...pending]) {
    try {
      if (deferred.alive) reject(vm, deferred, 'codemode disposed');
    } catch {
      // VM may already be tearing down.
    }
    try {
      deferred.dispose();
    } catch {
      // ignore
    }
  }
  pending.clear();
}

/**
 * Resolve the promises `yield_control()` handed the guest so the paused turn
 * continues in the next segment.
 */
export function resolveResumeDeferreds(state: BridgeState): void {
  const deferreds = state.resumeDeferreds;
  if (!deferreds || deferreds.length === 0) return;
  for (const deferred of deferreds.splice(0)) {
    state.pending?.delete(deferred);
    try {
      if (deferred.alive) deferred.resolve();
    } catch {
      // VM may already be tearing down.
    }
    try {
      deferred.dispose();
    } catch {
      // ignore
    }
  }
}

/** JSON round-trip a guest value through the guest's own `JSON.stringify`. */
function guestJsonCopy(vm: QuickJSContext, handle: QuickJSHandle): unknown {
  const type = vm.typeof(handle);
  if (type === 'undefined') return null;
  if (type === 'function') throw new Error('value is not JSON-safe');

  const json = vm.getProp(vm.global, 'JSON');
  const stringify = vm.getProp(json, 'stringify');
  const result = vm.callFunction(stringify, json, handle);
  stringify.dispose();
  json.dispose();
  if (result.error) {
    result.error.dispose();
    throw new Error('value is not JSON-safe');
  }
  if (vm.typeof(result.value) !== 'string') {
    result.value.dispose();
    throw new Error('value is not JSON-safe');
  }
  const text = vm.getString(result.value);
  result.value.dispose();
  return JSON.parse(text) as unknown;
}

/** Copy a host JSON value into the guest via the guest's own `JSON.parse`. */
function guestJsonPaste(vm: QuickJSContext, value: unknown): QuickJSHandle {
  const text = value === undefined ? undefined : JSON.stringify(value);
  if (text === undefined) return vm.undefined;

  const json = vm.getProp(vm.global, 'JSON');
  const parse = vm.getProp(json, 'parse');
  const arg = vm.newString(text);
  const result = vm.callFunction(parse, json, arg);
  arg.dispose();
  parse.dispose();
  json.dispose();
  if (result.error) {
    result.error.dispose();
    return vm.undefined;
  }
  return result.value;
}

/**
 * Install `yield_control`, `exit`, `store`, `load`, and `notify` on the guest
 * global. `yield_control` / `exit` hand back a promise that only the host can
 * settle, so the guest turn pauses without the isolate being disposed.
 */
export function installGuestGlobals(
  vm: QuickJSContext,
  state: BridgeState,
  globals: GuestGlobals,
): void {
  const pending = (state.pending ??= new Set());
  const resumeDeferreds = (state.resumeDeferreds ??= []);

  const pauseGuest = (): QuickJSHandle => {
    const deferred = vm.newPromise();
    pending.add(deferred);
    resumeDeferreds.push(deferred);
    return deferred.handle;
  };

  const keyOf = (handle: QuickJSHandle | undefined): string =>
    handle ? String(vm.dump(handle)) : 'undefined';

  const define = (
    name: string,
    impl: (...args: QuickJSHandle[]) => QuickJSHandle,
  ) => {
    const fn = vm.newFunction(name, impl);
    vm.setProp(vm.global, name, fn);
    fn.dispose();
  };

  define('yield_control', () => {
    state.yieldRequested = true;
    state.kick?.();
    return pauseGuest();
  });

  define('exit', () => {
    state.exitRequested = true;
    state.kick?.();
    return pauseGuest();
  });

  define('store', (keyHandle, valueHandle) => {
    const key = keyOf(keyHandle);
    let copy: unknown;
    try {
      copy = valueHandle === undefined ? null : guestJsonCopy(vm, valueHandle);
    } catch {
      // Catchable: a guest that handles this may keep running, yield, or return.
      const message = `store("${key}") value is not JSON-safe`;
      (state.dataViolations ??= new Set()).add(message);
      throw new Error(message);
    }
    globals.kv.set(key, copy);
    return vm.undefined;
  });

  define('load', (keyHandle) =>
    guestJsonPaste(vm, globals.kv.get(keyOf(keyHandle))),
  );

  define('notify', (...args) => {
    globals.notifications.push(
      args.map((handle) => String(vm.dump(handle))).join(' '),
    );
    return vm.undefined;
  });
}

export function installTools(
  vm: QuickJSContext,
  tools: CodemodeTool[],
  limits: { maxToolCalls: number },
  state: BridgeState,
): QuickJSHandle {
  const toolsHandle = vm.newObject();
  const pending = (state.pending ??= new Set());
  let inFlight = 0;
  const queue: Array<() => void> = [];

  const pump = () => {
    while (
      !state.disposed &&
      inFlight < CODEMODE_MAX_CONCURRENCY &&
      queue.length > 0
    ) {
      queue.shift()?.();
    }
  };

  const track = (deferred: QuickJSDeferredPromise) => {
    pending.add(deferred);
  };

  const finish = (deferred: QuickJSDeferredPromise) => {
    pending.delete(deferred);
    inFlight -= 1;
    pump();
    state.kick?.();
  };

  for (const def of tools) {
    const fn = vm.newFunction(def.name, (argHandle) => {
      const deferred = vm.newPromise();
      track(deferred);

      if (state.disposed) {
        reject(vm, deferred, 'codemode disposed');
        return deferred.handle;
      }
      if (state.admitted >= limits.maxToolCalls) {
        state.fatal = {
          kind: 'ToolCallLimitExceeded',
          message: `maxToolCalls (${limits.maxToolCalls}) exceeded`,
        };
        reject(vm, deferred, state.fatal.message);
        return deferred.handle;
      }

      let input: Record<string, unknown>;
      try {
        const dumped = argHandle ? vm.dump(argHandle) : {};
        input = JSON.parse(JSON.stringify(dumped ?? {})) as Record<
          string,
          unknown
        >;
      } catch {
        reject(vm, deferred, 'tool input is not JSON-safe');
        return deferred.handle;
      }

      state.admitted += 1;
      state.toolCalls.push(def.name);

      const run = () => {
        inFlight += 1;
        const at = new Date().toISOString();
        void def
          .handler(input)
          .then((output) => {
            state.onToolCall?.({ name: def.name, input, output, at });
            if (state.disposed) return;
            resolve(vm, deferred, output);
            executePendingJobs(vm);
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            state.onToolCall?.({
              name: def.name,
              input,
              output: `Error: ${message}`,
              error: message,
              at,
            });
            if (state.disposed) return;
            reject(vm, deferred, message);
            executePendingJobs(vm);
          })
          .finally(() => {
            finish(deferred);
          });
      };

      queue.push(run);
      pump();
      return deferred.handle;
    });
    vm.setProp(toolsHandle, def.name, fn);
    fn.dispose();
  }

  return toolsHandle;
}
