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
}

function executePendingJobs(vm: QuickJSContext): void {
  const result = vm.runtime.executePendingJobs();
  result.dispose();
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
    void deferred.settled.then(() => {
      pending.delete(deferred);
      if (!state.disposed) executePendingJobs(vm);
    });
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

      state.admitted += 1;
      state.toolCalls.push(def.name);

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

      const run = () => {
        inFlight += 1;
        const at = new Date().toISOString();
        void def
          .handler(input)
          .then((output) => {
            state.onToolCall?.({ name: def.name, input, output, at });
            if (state.disposed) return;
            resolve(vm, deferred, output);
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
          })
          .finally(() => {
            inFlight -= 1;
            pump();
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
