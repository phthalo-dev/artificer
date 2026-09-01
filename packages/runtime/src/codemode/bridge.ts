import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSHandle,
} from 'quickjs-emscripten';
import type { ToolInvocation } from '../storage/types.js';
import { enforceApproval } from '../tools/approval.js';
import type { ToolPolicyFile } from '../tools/tool-policy.js';
import type { RuntimeEvent } from '../context.js';
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
  policy?: ToolPolicyFile;
  emit?: (event: RuntimeEvent) => void;
  runId?: string;
  workstreamId?: string;
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
        const policy = state.policy ?? { version: 1 as const, rules: [] };
        const decision = enforceApproval({
          tool: def,
          input,
          policy,
          emit: state.emit,
          runId: state.runId,
          workstreamId: state.workstreamId,
        });
        const pendingResult = decision.allow
          ? def.handler(input)
          : Promise.resolve(decision.result);
        void pendingResult
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
