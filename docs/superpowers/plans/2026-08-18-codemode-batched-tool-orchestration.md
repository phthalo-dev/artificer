# Codemode Batched Tool Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `execute` tool on worker and orchestrator that runs a small JS program in QuickJS-WASM, so several existing tools can be sequenced or run concurrently in one model turn.

**Architecture:** `runCodemode()` owns a sync QuickJS context and a promise-bridge `tools` object. `createExecuteTool()` turns that into a `ToolDef`. `toolsForRole` appends it after built-ins and custom tools (never as a sibling of itself). Inner calls reuse `ToolContext.onToolCall` so the activity feed sees them.

**Tech Stack:** TypeScript ESM, `quickjs-emscripten@0.32.0` (sync/RELEASE_SYNC default, not Asyncify), Node `node:test` + `node:assert/strict`, existing `ToolDef` / `runToolLoop` / `RuntimeConfig`.

**Spec:** [docs/superpowers/specs/2026-08-17-codemode-batched-tool-orchestration-design.md](../specs/2026-08-17-codemode-batched-tool-orchestration-design.md)

## Global Constraints

- No Effect dependency. Runtime stays on the existing `ai` SDK + `zod` stack plus `quickjs-emscripten`.
- Sync QuickJS only — do not import Asyncify variants (`RELEASE_ASYNC`, `newQuickJSAsyncWASMModule`).
- Nested `execute` is impossible: it is never a sibling.
- Custom tools named `execute` are skipped when merging the identity registry (built-in wins). Log a warning.
- Inner calls count toward `maxToolCalls` only, not toward `maxIterationsPerCall`.
- The feature ships behind no flag: if the role has `execute`, it is available. Limits are the safety valve.
- Do not export `CodemodeResult` / `runCodemode` from `@artificer-ai/runtime`.
- Do not add `artificer.config.json` knobs (env only).
- Guest tool results are always strings — no silent `JSON.parse`.
- Do not SIGKILL in-flight `run_shell` when the guest times out.
- Do not hide sibling tools or change `runToolLoop`'s one-call-per-turn default.
- `execute` is worker + orchestrator only.

## File map

| File | Responsibility |
|---|---|
| `packages/runtime/src/config.ts` | `CodemodeLimits` on `RuntimeConfig`, env parse, defaults |
| `packages/runtime/src/codemode/types.ts` | `CodemodeResult`, `DiagnosticKind`, `CodemodeTool` |
| `packages/runtime/src/codemode/bridge.ts` | Install `tools.*`, admit/queue handlers (max 8), JSON-copy args, reject on throw |
| `packages/runtime/src/codemode/runtime.ts` | `runCodemode()` — wrap, eval, interrupt, memory, serialize, dispose |
| `packages/runtime/src/tools/execute.ts` | `createExecuteTool()` + sibling catalog text |
| `packages/runtime/src/tools/registry.ts` | Append `execute`; skip custom `execute` |
| `packages/runtime/src/context.ts` | Optional `onToolCall` |
| `packages/runtime/src/engine/call.ts` | Set `ctx.onToolCall` before `toolsForRole` |
| `packages/runtime/src/engine/roles.ts` | One-sentence prompt hint |
| `docs/reference/config.md`, `docs/guides/writing-custom-tools.md` | Env vars + reserved name |

---

### Task 1: Codemode limits on `RuntimeConfig`

**Files:**
- Modify: `packages/runtime/src/config.ts`
- Modify: `packages/runtime/src/engine/provider-config.test.ts` (`runtime()` helper)
- Modify: `packages/runtime/src/engine/provider-router.test.ts` (`runtime()` helper)
- Modify: `packages/runtime/src/engine/route-config.test.ts` (`runtime()` helper)
- Test: `packages/runtime/src/config.test.ts`

**Interfaces:**
- Consumes: nothing from later tasks
- Produces:
  - `export interface CodemodeLimits { timeoutMs: number; maxToolCalls: number; maxOutputBytes: number }`
  - `export const DEFAULT_CODEMODE_LIMITS: CodemodeLimits` with `{ timeoutMs: 120_000, maxToolCalls: 32, maxOutputBytes: 12_000 }`
  - `export function parseCodemodeLimits(env: NodeJS.ProcessEnv): CodemodeLimits`
  - `RuntimeConfig.codemode: CodemodeLimits` (required)

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/src/config.test.ts`:

```typescript
test('codemode limits default to 120s / 32 calls / 12000 bytes', () => {
  const config = loadConfig({ LLM_API_KEY: 'test-key' });
  assert.deepEqual(config.codemode, {
    timeoutMs: 120_000,
    maxToolCalls: 32,
    maxOutputBytes: 12_000,
  });
});

test('RUNTIME_CODEMODE_* env vars override defaults', () => {
  const config = loadConfig({
    LLM_API_KEY: 'test-key',
    RUNTIME_CODEMODE_TIMEOUT_MS: '5000',
    RUNTIME_CODEMODE_MAX_TOOL_CALLS: '4',
    RUNTIME_CODEMODE_MAX_OUTPUT_BYTES: '100',
  });
  assert.deepEqual(config.codemode, {
    timeoutMs: 5_000,
    maxToolCalls: 4,
    maxOutputBytes: 100,
  });
});

test('invalid RUNTIME_CODEMODE_* values warn and fall back to defaults', () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const config = loadConfig({
      LLM_API_KEY: 'test-key',
      RUNTIME_CODEMODE_TIMEOUT_MS: 'nope',
      RUNTIME_CODEMODE_MAX_TOOL_CALLS: '-1',
      RUNTIME_CODEMODE_MAX_OUTPUT_BYTES: '0.5',
    });
    assert.deepEqual(config.codemode, {
      timeoutMs: 120_000,
      maxToolCalls: 32,
      maxOutputBytes: 12_000,
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 3);
  assert.match(String(warnings[0][0]), /RUNTIME_CODEMODE_TIMEOUT_MS/);
  assert.match(String(warnings[1][0]), /RUNTIME_CODEMODE_MAX_TOOL_CALLS/);
  assert.match(String(warnings[2][0]), /RUNTIME_CODEMODE_MAX_OUTPUT_BYTES/);
});

test('timeoutMs of 0 is invalid and falls back', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const config = loadConfig({
      LLM_API_KEY: 'test-key',
      RUNTIME_CODEMODE_TIMEOUT_MS: '0',
    });
    assert.equal(config.codemode.timeoutMs, 120_000);
  } finally {
    console.warn = originalWarn;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && node --import tsx --test src/config.test.ts`

Expected: FAIL — `config.codemode` is undefined / property does not exist.

- [ ] **Step 3: Implement limits parsing and wire `loadConfig`**

In `packages/runtime/src/config.ts`, add next to the other exported interfaces:

```typescript
export interface CodemodeLimits {
  timeoutMs: number;
  maxToolCalls: number;
  maxOutputBytes: number;
}

export const DEFAULT_CODEMODE_LIMITS: CodemodeLimits = {
  timeoutMs: 120_000,
  maxToolCalls: 32,
  maxOutputBytes: 12_000,
};

function parseEnvInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min) {
    console.warn(
      `[artificer] invalid ${name} "${raw}"; using default ${fallback}.`,
    );
    return fallback;
  }
  return n;
}

export function parseCodemodeLimits(
  env: NodeJS.ProcessEnv,
): CodemodeLimits {
  return {
    timeoutMs: parseEnvInt(
      env,
      'RUNTIME_CODEMODE_TIMEOUT_MS',
      DEFAULT_CODEMODE_LIMITS.timeoutMs,
      1,
    ),
    maxToolCalls: parseEnvInt(
      env,
      'RUNTIME_CODEMODE_MAX_TOOL_CALLS',
      DEFAULT_CODEMODE_LIMITS.maxToolCalls,
      0,
    ),
    maxOutputBytes: parseEnvInt(
      env,
      'RUNTIME_CODEMODE_MAX_OUTPUT_BYTES',
      DEFAULT_CODEMODE_LIMITS.maxOutputBytes,
      0,
    ),
  };
}
```

Add `codemode: CodemodeLimits` to `RuntimeConfig`. In `loadConfig`'s returned object, set `codemode: parseCodemodeLimits(env)`. `mergeWithDefinition` spreads `base`, so it inherits `codemode` with no extra field.

In each `runtime()` helper (`provider-config.test.ts`, `provider-router.test.ts`, `route-config.test.ts`) add:

```typescript
codemode: {
  timeoutMs: 120_000,
  maxToolCalls: 32,
  maxOutputBytes: 12_000,
},
```

so `tsc` still type-checks those full `RuntimeConfig` literals.

- [ ] **Step 4: Run tests and type-check**

Run:

```
cd packages/runtime && node --import tsx --test src/config.test.ts
cd packages/runtime && pnpm type-check
```

Expected: tests PASS; `tsc --noEmit` PASS. If `tsc` still fails on another `RuntimeConfig` literal, add the same `codemode` field (search for `maxPlannerIterations:`).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/config.ts packages/runtime/src/config.test.ts \
  packages/runtime/src/engine/provider-config.test.ts \
  packages/runtime/src/engine/provider-router.test.ts \
  packages/runtime/src/engine/route-config.test.ts
git commit -m "$(cat <<'EOF'
feat(runtime): add codemode execution limits to RuntimeConfig

Give execute a host-owned timeout/call/output budget parsed from env, with warn-and-default on bad values.
EOF
)"
```

---

### Task 2: QuickJS runtime and tool bridge

**Files:**
- Create: `packages/runtime/src/codemode/types.ts`
- Create: `packages/runtime/src/codemode/bridge.ts`
- Create: `packages/runtime/src/codemode/runtime.ts`
- Test: `packages/runtime/src/codemode/runtime.test.ts`
- Modify: `packages/runtime/package.json` (add `quickjs-emscripten`)

**Interfaces:**
- Consumes: `CodemodeLimits` from `../config.js`
- Produces:
  - `export type DiagnosticKind = 'ParseError' | 'InvalidDataValue' | 'ToolCallLimitExceeded' | 'TimeoutExceeded' | 'ExecutionFailure'`
  - `export type CodemodeResult = { ok: true; value: unknown; logs?: string[]; truncated?: true; toolCalls: string[] } | { ok: false; error: { kind: DiagnosticKind; message: string }; logs?: string[]; truncated?: true; toolCalls: string[] }`
  - `export interface CodemodeTool { name: string; handler: (input: Record<string, unknown>) => Promise<string> }`
  - `export const CODEMODE_MAX_CONCURRENCY = 8`
  - `export const CODEMODE_MEMORY_BYTES = 32 * 1024 * 1024`
  - `export async function runCodemode(opts: { code: string; tools: CodemodeTool[]; limits: CodemodeLimits; onToolCall?: (invocation: ToolInvocation) => void }): Promise<CodemodeResult>`

- [ ] **Step 1: Add the dependency**

From repo root:

```
pnpm add quickjs-emscripten@0.32.0 --filter @artificer-ai/runtime
```

Do **not** add `effect`. Confirm `packages/runtime/package.json` lists `"quickjs-emscripten": "0.32.0"` (or `^0.32.0`) and has no Asyncify-only variant packages.

- [ ] **Step 2: Write the failing tests**

Create `packages/runtime/src/codemode/runtime.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CODEMODE_LIMITS } from '../config.js';
import { runCodemode, type CodemodeTool } from './runtime.js';

const limits = {
  ...DEFAULT_CODEMODE_LIMITS,
  timeoutMs: 5_000,
};

function tool(
  name: string,
  handler: CodemodeTool['handler'],
): CodemodeTool {
  return { name, handler };
}

test('empty code is ParseError', async () => {
  const result = await runCodemode({ code: '  ', tools: [], limits });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'ParseError');
});

test('syntax error is ParseError', async () => {
  const result = await runCodemode({ code: 'function {', tools: [], limits });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'ParseError');
});

test('undefined return becomes null', async () => {
  const result = await runCodemode({
    code: 'const x = 1;',
    tools: [],
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, null);
});

test('sequential tool calls see prior results', async () => {
  const tools = [
    tool('echo', async (input) => String(input.v)),
    tool('wrap', async (input) => `(${input.v})`),
  ];
  const result = await runCodemode({
    code: `
      const a = await tools.echo({ v: 'hi' });
      const b = await tools.wrap({ v: a });
      return b;
    `,
    tools,
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, '(hi)');
    assert.deepEqual(result.toolCalls, ['echo', 'wrap']);
  }
});

test('Promise.all runs tools concurrently', async () => {
  const wait = (ms: number) =>
    new Promise<string>((r) => setTimeout(() => r('ok'), ms));
  const tools = [
    tool('a', async () => wait(80)),
    tool('b', async () => wait(80)),
  ];
  const start = Date.now();
  const result = await runCodemode({
    code: `return await Promise.all([tools.a({}), tools.b({})]);`,
    tools,
    limits,
  });
  const elapsed = Date.now() - start;
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, ['ok', 'ok']);
  assert.ok(elapsed < 140, `expected overlap, took ${elapsed}ms`);
});

test('ninth concurrent call waits rather than failing', async () => {
  const tools = Array.from({ length: 9 }, (_, i) =>
    tool(`t${i}`, async () => {
      await new Promise((r) => setTimeout(r, 50));
      return String(i);
    }),
  );
  const names = tools.map((t) => `tools.${t.name}({})`).join(', ');
  const start = Date.now();
  const result = await runCodemode({
    code: `return await Promise.all([${names}]);`,
    tools,
    limits,
  });
  const elapsed = Date.now() - start;
  assert.equal(result.ok, true);
  assert.ok(elapsed >= 90, `9th call should wait for a slot, took ${elapsed}ms`);
  assert.ok(elapsed < 250, `should still be two waves, took ${elapsed}ms`);
});

test('exceeding maxToolCalls is ToolCallLimitExceeded', async () => {
  const tools = [tool('n', async () => 'x')];
  const result = await runCodemode({
    code: `
      await tools.n({});
      await tools.n({});
      await tools.n({});
      return 1;
    `,
    tools,
    limits: { ...limits, maxToolCalls: 2 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'ToolCallLimitExceeded');
  assert.deepEqual(result.toolCalls, ['n', 'n']);
});

test('tight loop hits TimeoutExceeded', async () => {
  const result = await runCodemode({
    code: 'while (true) {}',
    tools: [],
    limits: { ...limits, timeoutMs: 50 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'TimeoutExceeded');
});

test('oversize return is ok with truncated true', async () => {
  const result = await runCodemode({
    code: `return 'x'.repeat(1000);`,
    tools: [],
    limits: { ...limits, maxOutputBytes: 50 },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.truncated, true);
    const encoded = Buffer.byteLength(JSON.stringify(result.value), 'utf8');
    assert.ok(encoded <= 50 || typeof result.value === 'string');
  }
});

test('unknown tool is catchable; uncaught is ExecutionFailure', async () => {
  const caught = await runCodemode({
    code: `
      try { await tools.nope({}); }
      catch (e) { return 'caught'; }
    `,
    tools: [],
    limits,
  });
  assert.equal(caught.ok, true);
  if (caught.ok) assert.equal(caught.value, 'caught');

  const uncaught = await runCodemode({
    code: `await tools.nope({}); return 1;`,
    tools: [],
    limits,
  });
  assert.equal(uncaught.ok, false);
  if (!uncaught.ok) {
    assert.equal(uncaught.error.kind, 'ExecutionFailure');
    assert.match(uncaught.error.message, /nope/);
    assert.doesNotMatch(uncaught.error.message, /\/Users\//);
  }
});

test('inner handler reject is catchable', async () => {
  const tools = [
    tool('boom', async () => {
      throw new Error('nope');
    }),
  ];
  const result = await runCodemode({
    code: `
      try { await tools.boom({}); }
      catch (e) { return e.message; }
    `,
    tools,
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'nope');
});

test('guest has no process, require, or fs', async () => {
  const result = await runCodemode({
    code: `
      return {
        process: typeof process,
        require: typeof require,
        fs: typeof fs,
      };
    `,
    tools: [],
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      process: 'undefined',
      require: 'undefined',
      fs: 'undefined',
    });
  }
});

test('returning a function is InvalidDataValue', async () => {
  const result = await runCodemode({
    code: 'return function () {};',
    tools: [],
    limits,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'InvalidDataValue');
});

test('mutating tool args does not mutate the host object', async () => {
  const seen: unknown[] = [];
  const host = { n: 1 };
  const tools = [
    tool('take', async (input) => {
      seen.push(input);
      return 'ok';
    }),
  ];
  await runCodemode({
    code: `
      const a = { n: 1 };
      await tools.take(a);
      a.n = 2;
      return a.n;
    `,
    tools,
    limits,
  });
  assert.deepEqual(seen[0], { n: 1 });
  assert.notEqual(seen[0], host);
});

test('console.log appears in logs', async () => {
  const result = await runCodemode({
    code: `console.log('hi', 1); return 2;`,
    tools: [],
    limits,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, 2);
    assert.ok(result.logs?.some((l) => l.includes('hi')));
  }
});

test('onToolCall fires for inner success and error', async () => {
  const seen: string[] = [];
  const tools = [
    tool('ok', async () => 'yes'),
    tool('bad', async () => {
      throw new Error('x');
    }),
  ];
  await runCodemode({
    code: `
      await tools.ok({});
      try { await tools.bad({}); } catch (e) {}
      return 1;
    `,
    tools,
    limits,
    onToolCall: (inv) => seen.push(`${inv.name}:${inv.error ?? 'ok'}`),
  });
  assert.deepEqual(seen, ['ok:ok', 'bad:x']);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/runtime && node --import tsx --test src/codemode/runtime.test.ts`

Expected: FAIL — `Cannot find module './runtime.js'` (or `runCodemode` is not a function).

- [ ] **Step 4: Implement types, bridge, and runtime**

Create `packages/runtime/src/codemode/types.ts`:

```typescript
import type { ToolInvocation } from '../storage/types.js';
import type { CodemodeLimits } from '../config.js';

export type DiagnosticKind =
  | 'ParseError'
  | 'InvalidDataValue'
  | 'ToolCallLimitExceeded'
  | 'TimeoutExceeded'
  | 'ExecutionFailure';

export type CodemodeResult =
  | {
      ok: true;
      value: unknown;
      logs?: string[];
      truncated?: true;
      toolCalls: string[];
    }
  | {
      ok: false;
      error: { kind: DiagnosticKind; message: string };
      logs?: string[];
      truncated?: true;
      toolCalls: string[];
    };

export interface CodemodeTool {
  name: string;
  handler: (input: Record<string, unknown>) => Promise<string>;
}

export const CODEMODE_MAX_CONCURRENCY = 8;
export const CODEMODE_MEMORY_BYTES = 32 * 1024 * 1024;

export interface RunCodemodeOptions {
  code: string;
  tools: CodemodeTool[];
  limits: CodemodeLimits;
  onToolCall?: (invocation: ToolInvocation) => void;
}
```

Create `packages/runtime/src/codemode/bridge.ts`. Critical: every `tools.<name>` call **immediately** returns a guest promise (never block the `newFunction` callback). Cap in-flight handlers at `CODEMODE_MAX_CONCURRENCY` with a host-side queue. JSON-copy args with `JSON.parse(JSON.stringify(dumped))`. On handler throw, reject the guest promise with `message` only. If `state.disposed`, do not resolve/reject into the VM.

```typescript
import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import {
  CODEMODE_MAX_CONCURRENCY,
  type CodemodeTool,
  type DiagnosticKind,
} from './types.js';
import type { ToolInvocation } from '../storage/types.js';

export interface BridgeState {
  disposed: boolean;
  toolCalls: string[];
  admitted: number;
  fatal?: { kind: DiagnosticKind; message: string };
  onToolCall?: (invocation: ToolInvocation) => void;
}

export function installTools(
  vm: QuickJSContext,
  tools: CodemodeTool[],
  limits: { maxToolCalls: number },
  state: BridgeState,
): QuickJSHandle {
  const toolsHandle = vm.newObject();
  let inFlight = 0;
  const queue: Array<() => void> = [];

  const pump = () => {
    while (inFlight < CODEMODE_MAX_CONCURRENCY && queue.length > 0) {
      const next = queue.shift();
      next?.();
    }
  };

  for (const def of tools) {
    const fn = vm.newFunction(def.name, (argHandle) => {
      const deferred = vm.newPromise();
      if (state.disposed) {
        deferred.reject(vm.newString('codemode disposed'));
        deferred.settled.then(() => vm.runtime.executePendingJobs());
        return deferred.handle;
      }
      if (state.admitted >= limits.maxToolCalls) {
        state.fatal = {
          kind: 'ToolCallLimitExceeded',
          message: `maxToolCalls (${limits.maxToolCalls}) exceeded`,
        };
        deferred.reject(vm.newString(state.fatal.message));
        deferred.settled.then(() => vm.runtime.executePendingJobs());
        return deferred.handle;
      }
      state.admitted += 1;
      state.toolCalls.push(def.name);

      let input: Record<string, unknown> = {};
      try {
        const dumped = argHandle ? vm.dump(argHandle) : {};
        input = JSON.parse(JSON.stringify(dumped ?? {})) as Record<
          string,
          unknown
        >;
      } catch {
        deferred.reject(vm.newString('tool input is not JSON-safe'));
        deferred.settled.then(() => vm.runtime.executePendingJobs());
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
            deferred.resolve(vm.newString(output));
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
            deferred.reject(vm.newString(message));
          })
          .finally(() => {
            inFlight -= 1;
            if (!state.disposed) {
              deferred.settled.then(() => vm.runtime.executePendingJobs());
            }
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
```

Create `packages/runtime/src/codemode/runtime.ts`. Use `getQuickJS()` (sync default). Wrap code as `` `(async () => {\n${code}\n})()` ``. Empty/whitespace → `ParseError` before eval. `setMemoryLimit(CODEMODE_MEMORY_BYTES)`. `setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs))`. Inject `console.log/warn/error` that push `args.map(String).join(' ')` onto `logs`. After `evalCode`, `unwrapResult` then `resolvePromise`. On interrupt, `TimeoutExceeded`. Map guest exceptions to `ExecutionFailure` with `error.message` only (no host paths). `toJsonSafe(value)`: `JSON.parse(JSON.stringify(value))` after rejecting `typeof === 'function'`. `undefined` → `null`. Apply `maxOutputBytes` to UTF-8 size of `JSON.stringify({ value, logs })`; if over, set `value` to the truncated serialized text plus `\n(truncated)`, keep leading logs that fit, set `truncated: true`, still `ok: true` unless a fatal already fired. Always `vm.dispose()` (and runtime if you created one) in `finally`. If `state.fatal` is set after the program settles, return that failure (limit exceeded wins even if the program also threw). Re-export `runCodemode`, `CODEMODE_MAX_CONCURRENCY`, `CODEMODE_MEMORY_BYTES`, and the types from `runtime.ts` so tests import from `./runtime.js`.

Skeleton:

```typescript
import {
  getQuickJS,
  shouldInterruptAfterDeadline,
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

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'function') {
    throw Object.assign(new Error('result is not JSON-safe'), {
      kind: 'InvalidDataValue' as const,
    });
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw Object.assign(new Error('result is not JSON-safe'), {
      kind: 'InvalidDataValue' as const,
    });
  }
}

function applyOutputBudget(
  value: unknown,
  logs: string[],
  maxOutputBytes: number,
): { value: unknown; logs?: string[]; truncated?: true } {
  const packed = JSON.stringify({ value, logs });
  if (Buffer.byteLength(packed, 'utf8') <= maxOutputBytes) {
    return logs.length > 0 ? { value, logs } : { value };
  }
  const marker = '\n(truncated)';
  const budget = Math.max(0, maxOutputBytes - Buffer.byteLength(marker, 'utf8'));
  const asText = JSON.stringify(value);
  const sliced = asText.slice(
    0,
    Math.max(0, Math.floor(budget / 2)),
  );
  return {
    value: sliced + marker,
    logs: logs.slice(0, 1),
    truncated: true,
  };
}

export async function runCodemode(
  opts: RunCodemodeOptions,
): Promise<CodemodeResult> {
  const code = opts.code.trim();
  if (!code) {
    return {
      ok: false,
      error: { kind: 'ParseError', message: 'code is empty' },
      toolCalls: [],
    };
  }

  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();
  const logs: string[] = [];
  const state: BridgeState = {
    disposed: false,
    toolCalls: [],
    admitted: 0,
    onToolCall: opts.onToolCall,
  };

  try {
    vm.runtime.setMemoryLimit(CODEMODE_MEMORY_BYTES);
    vm.runtime.setInterruptHandler(
      shouldInterruptAfterDeadline(Date.now() + opts.limits.timeoutMs),
    );

    const consoleHandle = vm.newObject();
    for (const method of ['log', 'warn', 'error'] as const) {
      const fn = vm.newFunction(method, (...args) => {
        logs.push(args.map((h) => String(vm.dump(h))).join(' '));
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

    const wrapped = `(async () => {\n${opts.code}\n})()`;
    const evalResult = vm.evalCode(wrapped);
    if (evalResult.error) {
      const dumped = vm.dump(evalResult.error);
      evalResult.error.dispose();
      const message =
        dumped && typeof dumped === 'object' && 'message' in dumped
          ? String((dumped as { message: unknown }).message)
          : String(dumped);
      const interrupted = /interrupted/i.test(message);
      return {
        ok: false,
        error: {
          kind: interrupted ? 'TimeoutExceeded' : 'ParseError',
          message: interrupted ? 'timeoutMs exceeded' : message,
        },
        logs: logs.length > 0 ? logs : undefined,
        toolCalls: state.toolCalls,
      };
    }
    const promiseHandle = vm.unwrapResult(evalResult);
    const resolved = await vm.resolvePromise(promiseHandle);
    promiseHandle.dispose();
    vm.runtime.executePendingJobs();

    if (state.fatal) {
      return {
        ok: false,
        error: state.fatal,
        logs: logs.length > 0 ? logs : undefined,
        toolCalls: state.toolCalls,
      };
    }

    if (resolved.error) {
      const dumped = vm.dump(resolved.error);
      resolved.error.dispose();
      const message =
        dumped && typeof dumped === 'object' && 'message' in dumped
          ? String((dumped as { message: unknown }).message)
          : String(dumped);
      const interrupted = /interrupted/i.test(message);
      return {
        ok: false,
        error: {
          kind: interrupted ? 'TimeoutExceeded' : 'ExecutionFailure',
          message: interrupted ? 'timeoutMs exceeded' : message,
        },
        logs: logs.length > 0 ? logs : undefined,
        toolCalls: state.toolCalls,
      };
    }

    const raw = vm.dump(resolved.value);
    resolved.value.dispose();
    let value: unknown;
    try {
      value = jsonSafe(raw);
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: 'InvalidDataValue',
          message: err instanceof Error ? err.message : String(err),
        },
        logs: logs.length > 0 ? logs : undefined,
        toolCalls: state.toolCalls,
      };
    }

    const capped = applyOutputBudget(value, logs, opts.limits.maxOutputBytes);
    return {
      ok: true,
      value: capped.value,
      logs: capped.logs,
      ...(capped.truncated ? { truncated: true as const } : {}),
      toolCalls: state.toolCalls,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind: DiagnosticKind = /interrupted/i.test(message)
      ? 'TimeoutExceeded'
      : 'ExecutionFailure';
    return {
      ok: false,
      error: {
        kind,
        message: kind === 'TimeoutExceeded' ? 'timeoutMs exceeded' : message,
      },
      logs: logs.length > 0 ? logs : undefined,
      toolCalls: state.toolCalls,
    };
  } finally {
    state.disposed = true;
    vm.dispose();
  }
}
```

Handle QuickJS `dump` of Error objects so `e.message` in guest `catch` is the string `'nope'`, not `[object Object]`. If `vm.newString` on reject is not enough for `instanceof Error` in guest, reject with `vm.newError(message)` if that API exists on 0.32; otherwise keep `newString` and assert the test against `String(e)` / `e.message` accordingly — **change the test to match guest-visible rejection shape**, not the reverse. Host stacks still must not appear.

If `getQuickJS().newContext()` does not expose `runtime` on the context, use `QuickJS.newRuntime()` then `runtime.newContext()`, call `setMemoryLimit` / `setInterruptHandler` on the runtime, and dispose both.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/runtime && node --import tsx --test src/codemode/runtime.test.ts`

Expected: PASS (all tests in that file). If `Promise.all` or the 9th-call timing test is flaky on a loaded machine, increase the delay (80→120) rather than weakening the overlap assertion below 1.5× a single delay.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/package.json packages/runtime/pnpm-lock.yaml pnpm-lock.yaml \
  packages/runtime/src/codemode
git commit -m "$(cat <<'EOF'
feat(runtime): run bounded JS tool programs in QuickJS WASM

Sequence and concurrently call host tools from a guest program without giving it Node fs, process, or require.
EOF
)"
```

If the lockfile only exists at the repo root, add that path and not a missing package lockfile.

---

### Task 3: `execute` tool, registry, and activity-feed wiring

**Files:**
- Create: `packages/runtime/src/tools/execute.ts`
- Test: `packages/runtime/src/tools/execute.test.ts`
- Modify: `packages/runtime/src/tools/registry.ts`
- Modify: `packages/runtime/src/tools/registry.test.ts`
- Modify: `packages/runtime/src/context.ts`
- Modify: `packages/runtime/src/engine/call.ts`

**Interfaces:**
- Consumes: `runCodemode` from `../codemode/runtime.js`; `DEFAULT_CODEMODE_LIMITS` / `CodemodeLimits` from `../config.js`
- Produces:
  - `export function createExecuteTool(ctx: ToolContext, siblings: ToolDef[], limits: CodemodeLimits): ToolDef` with `name: 'execute'`
  - `ToolContext.onToolCall?: (invocation: ToolInvocation) => void`
  - `toolsForRole('worker' | 'orchestrator')` includes `execute`; other roles do not
  - Custom tools named `execute` are skipped with `console.warn('[artificer] custom tool "execute" is reserved and was skipped')`

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/src/tools/execute.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CODEMODE_LIMITS } from '../config.js';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { createExecuteTool } from './execute.js';

function ctx(): ToolContext {
  return {
    engine: { config: { codemode: DEFAULT_CODEMODE_LIMITS } } as ToolContext['engine'],
    run: { id: 'run_1' } as ToolContext['run'],
    workspaceDir: '/tmp',
  };
}

test('execute runs sibling tools and returns JSON', async () => {
  const siblings: ToolDef[] = [
    {
      name: 'echo',
      description: 'Echo v',
      inputSchema: {
        type: 'object',
        properties: { v: { type: 'string', description: 'value' } },
        required: ['v'],
      },
      handler: async (input) => String(input.v),
    },
  ];
  const tool = createExecuteTool(ctx(), siblings, DEFAULT_CODEMODE_LIMITS);
  assert.equal(tool.name, 'execute');
  assert.match(tool.description, /tools\.echo/);
  assert.match(tool.description, /Echo v/);
  const raw = await tool.handler({
    code: 'return await tools.echo({ v: "z" });',
  });
  const parsed = JSON.parse(raw) as { ok: boolean; value: unknown };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value, 'z');
});
```

Append to `packages/runtime/src/tools/registry.test.ts` (keep `freshCtx`; add `defineTool` / `ToolRegistry` imports):

```typescript
import { defineTool } from '../api/define-tool.js';
import { ToolRegistry } from '../api/tool-registry.js';

for (const role of ['worker', 'orchestrator'] as const) {
  test(`toolsForRole('${role}') includes execute`, async () => {
    const ctx = await freshCtx(role);
    const tools = toolsForRole(role, ctx);
    assert.ok(
      tools.some((t) => t.name === 'execute'),
      `${role} should have execute`,
    );
  });
}

for (const role of [
  'planner',
  'reviewer',
  'communicator',
  'librarian',
] as const) {
  test(`toolsForRole('${role}') does not include execute`, async () => {
    const ctx = await freshCtx(role);
    const tools = toolsForRole(role, ctx);
    assert.ok(
      !tools.some((t) => t.name === 'execute'),
      `${role} should not have execute`,
    );
  });
}

test('execute siblings include custom tools and exclude execute', async () => {
  const ctx = await freshCtx('worker');
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: 'custom_ping',
      description: 'ping',
      input: { type: 'object', properties: {}, required: [] },
      roles: ['worker'],
      execute: async () => 'pong',
    }),
  );
  const tools = toolsForRole('worker', ctx, registry);
  const execute = tools.find((t) => t.name === 'execute');
  assert.ok(execute);
  assert.match(execute.description, /tools\.custom_ping/);
  assert.doesNotMatch(execute.description, /tools\.execute/);
  const names = tools.filter((t) => t.name === 'execute');
  assert.equal(names.length, 1);
});

test('custom tool named execute is skipped with a warning', async () => {
  const ctx = await freshCtx('worker');
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: 'execute',
      description: 'should not ship',
      input: { type: 'object', properties: {}, required: [] },
      roles: ['worker'],
      execute: async () => 'nope',
    }),
  );
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const tools = toolsForRole('worker', ctx, registry);
    const execute = tools.find((t) => t.name === 'execute');
    assert.ok(execute);
    assert.match(execute.description, /tools\./);
    assert.doesNotMatch(execute.description, /should not ship/);
  } finally {
    console.warn = originalWarn;
  }
  assert.match(String(warnings[0]?.[0]), /reserved/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```
cd packages/runtime && node --import tsx --test src/tools/execute.test.ts src/tools/registry.test.ts
```

Expected: FAIL — `Cannot find module './execute.js'` and worker has no `execute`.

- [ ] **Step 3: Implement the tool factory, registry, context, and call wiring**

`packages/runtime/src/tools/execute.ts`:

```typescript
import type { CodemodeLimits } from '../config.js';
import type { ToolContext } from '../context.js';
import type { JsonSchema, ToolDef } from '../llm/types.js';
import { runCodemode } from '../codemode/runtime.js';

function formatSibling(def: ToolDef): string {
  const props = def.inputSchema.properties ?? {};
  const fields = Object.entries(props).map(([key, schema]) => {
    const s = schema as { type?: unknown; description?: unknown };
    const type = typeof s.type === 'string' ? s.type : 'unknown';
    const desc =
      typeof s.description === 'string' ? ` // ${s.description}` : '';
    return `  ${key}: ${type}${desc}`;
  });
  const body = fields.length > 0 ? `{\n${fields.join(',\n')}\n}` : '{}';
  return `tools.${def.name}(input: ${body}): Promise<string>\n  ${def.description}`;
}

export function createExecuteTool(
  ctx: ToolContext,
  siblings: ToolDef[],
  limits: CodemodeLimits,
): ToolDef {
  const catalog = siblings.map(formatSibling).join('\n\n');
  return {
    name: 'execute',
    description: `Run a small JavaScript program that calls this role's tools without a model round-trip per call. Write the body of an async function. \`return\` is the result. Call tools as \`await tools.read_file({ path: "..." })\`. Independent work: \`await Promise.all([...])\`. Missing tools throw (catchable). Nested execute is not available.

Available tools:
${catalog}`,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Body of an async function. `return` is the result. Call tools as `await tools.read_file({ path: "..." })`. Independent work: `await Promise.all([...])`.',
        },
      },
      required: ['code'],
    } satisfies JsonSchema,
    handler: async (input) => {
      const result = await runCodemode({
        code: String(input.code ?? ''),
        tools: siblings.map((s) => ({ name: s.name, handler: s.handler })),
        limits,
        onToolCall: ctx.onToolCall,
      });
      return JSON.stringify(result);
    },
  };
}
```

In `packages/runtime/src/context.ts`, add to `ToolContext`:

```typescript
onToolCall?: (invocation: ToolInvocation) => void;
```

(`ToolInvocation` is already imported in that file.)

In `packages/runtime/src/tools/registry.ts`, import `createExecuteTool` and `DEFAULT_CODEMODE_LIMITS`. Replace the custom-registry block and the `return result` with:

```typescript
  if (customRegistry) {
    const custom = customRegistry.toolsForRole(role as RoleName);
    for (const t of custom) {
      if (t.name === 'execute') {
        console.warn(
          '[artificer] custom tool "execute" is reserved and was skipped',
        );
        continue;
      }
      result.push(t.toToolDef(ctx));
    }
  }

  if (role === 'worker' || role === 'orchestrator') {
    const limits =
      ctx.engine.config.codemode ?? DEFAULT_CODEMODE_LIMITS;
    result.push(createExecuteTool(ctx, result, limits));
  }

  return result;
```

`freshCtx` uses `config: {}`, so the `?? DEFAULT_CODEMODE_LIMITS` branch must stay.

In `packages/runtime/src/engine/call.ts`, construct `onToolCall` **before** `toolsForRole` and put it on `ctx`:

```typescript
  const onToolCall = (invocation: ToolInvocation) => {
    run.toolCalls.push(invocation);
    engine.emit({
      kind: 'tool',
      at: invocation.at,
      data: { ...invocation, runId: run.id },
    });
    void store.saveRun(run);
  };

  const ctx: ToolContext = { engine, run, workspaceDir, onToolCall };
```

Remove the duplicate `onToolCall` lambda later in `runToolLoop({...})` — pass the same `onToolCall` function. Import `ToolInvocation` from `../storage/types.js` if `call.ts` does not already.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```
cd packages/runtime && node --import tsx --test src/tools/execute.test.ts src/tools/registry.test.ts src/codemode/runtime.test.ts
cd packages/runtime && pnpm type-check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/tools/execute.ts packages/runtime/src/tools/execute.test.ts \
  packages/runtime/src/tools/registry.ts packages/runtime/src/tools/registry.test.ts \
  packages/runtime/src/context.ts packages/runtime/src/engine/call.ts
git commit -m "$(cat <<'EOF'
feat(runtime): expose execute on worker and orchestrator

Let those roles batch sibling tools in one turn, and record inner calls on the run timeline.
EOF
)"
```

---

### Task 4: Prompts, docs, and changeset

**Files:**
- Modify: `packages/runtime/src/engine/roles.ts` (`WORKER` and `ORCHESTRATOR` system prompts)
- Modify: `packages/runtime/src/engine/roles.test.ts`
- Modify: `docs/reference/config.md`
- Modify: `docs/guides/writing-custom-tools.md`
- Modify: `packages/cli/src/commands/init.ts` (env comment block)
- Create: `.changeset/codemode-execute.md`

**Interfaces:**
- Consumes: nothing new
- Produces: prompt sentence in worker + orchestrator; env documented; `execute` reserved-name note; patch changeset for `@artificer-ai/runtime`

- [ ] **Step 1: Write the failing prompt tests**

Append to `packages/runtime/src/engine/roles.test.ts`:

```typescript
test('worker prompt prefers execute for batched tool calls', () => {
  const system = getRole('worker').system('TestAgent');
  assert.match(system, /prefer the `execute` tool/i);
});

test('orchestrator prompt prefers execute for batched tool calls', () => {
  const system = getRole('orchestrator').system('TestAgent');
  assert.match(system, /prefer the `execute` tool/i);
});

test('planner prompt does not mention the execute tool', () => {
  const system = getRole('planner').system('TestAgent');
  assert.doesNotMatch(system, /prefer the `execute` tool/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/runtime && node --import tsx --test src/engine/roles.test.ts`

Expected: FAIL — worker/orchestrator prompts lack the sentence.

- [ ] **Step 3: Add the one-sentence hint**

In `WORKER.system`, after `Use the grep tool for search; do not run grep or rg via run_shell.` add:

```
For several independent or sequential tool calls (for example reading multiple files), prefer the `execute` tool over one-at-a-time calls.
```

In `ORCHESTRATOR.system`, after `Do not implement code yourself — delegate.` add:

```
For several independent or sequential tool calls (for example get_status plus a few reads), prefer the `execute` tool over one-at-a-time calls.
```

Do not paste a syntax tutorial into either prompt.

- [ ] **Step 4: Docs and changeset**

Add a subsection to `docs/reference/config.md` after the top-level fields table (env-only, like `RUNTIME_MAX_RUN_MS`):

```markdown
### Codemode (`execute` tool)

Worker and orchestrator can call `execute` to run a small JavaScript program that sequences their other tools. Limits are env-only (not `artificer.config.json`):

| Env | Default | Description |
|---|---|---|
| `RUNTIME_CODEMODE_TIMEOUT_MS` | `120000` | Wall-clock cap for one `execute` program (QuickJS interrupt). Does not SIGKILL in-flight `run_shell`. |
| `RUNTIME_CODEMODE_MAX_TOOL_CALLS` | `32` | Max inner tool calls admitted during one `execute`. |
| `RUNTIME_CODEMODE_MAX_OUTPUT_BYTES` | `12000` | UTF-8 cap on the JSON result (`value` + `logs`). Oversize returns `truncated: true`. |
```

In `docs/guides/writing-custom-tools.md`, after the `roles` field bullets, add:

```markdown
Worker and orchestrator can also call custom tools from the `execute` program as `await tools.<name>(input)`. `execute` is a reserved name — a custom tool with that name is skipped.
```

In `packages/cli/src/commands/init.ts`, in the Runtime tuning comment block, add:

```
# RUNTIME_CODEMODE_TIMEOUT_MS=120000         # execute program wall-clock cap
# RUNTIME_CODEMODE_MAX_TOOL_CALLS=32         # inner tool calls per execute
# RUNTIME_CODEMODE_MAX_OUTPUT_BYTES=12000    # execute JSON result cap
```

Create `.changeset/codemode-execute.md`:

```markdown
---
'@artificer-ai/runtime': minor
---

Add an `execute` tool for worker and orchestrator that runs a bounded JavaScript program to sequence and concurrently call existing tools in one model turn.
```

Use `minor` (new user-facing tool), not `patch`.

- [ ] **Step 5: Run tests**

Run:

```
cd packages/runtime && node --import tsx --test src/engine/roles.test.ts src/codemode/runtime.test.ts src/tools/execute.test.ts src/tools/registry.test.ts src/config.test.ts
cd packages/runtime && pnpm type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/engine/roles.ts packages/runtime/src/engine/roles.test.ts \
  docs/reference/config.md docs/guides/writing-custom-tools.md \
  packages/cli/src/commands/init.ts .changeset/codemode-execute.md
git commit -m "$(cat <<'EOF'
docs: document execute tool and hint worker/orchestrator to use it

Point those roles at batched tool calls and record the runtime limits in config reference.
EOF
)"
```

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| Opt-in `execute`, not a loop replacement | 3 |
| Sync QuickJS, promise bridge, no Asyncify | 2 |
| Worker + orchestrator only | 3, 4 |
| Isolation / JSON boundary / string tool results | 2 |
| Concurrency 8 via host queue, not blocking `newFunction` | 2 |
| `timeoutMs` / `maxToolCalls` / `maxOutputBytes` + env | 1, 2 |
| `ToolContext.onToolCall` | 3 |
| Catalog in description, no `$codemode.search` | 3 |
| Prompt one-liner, no tutorial | 4 |
| Reserved custom name `execute` | 3 |
| Docs + env comments | 4 |
| Not exported from public API | 2 (no `index.ts` change) |
| No `artificer.config.json` knobs | 1, 4 |

**Placeholder scan:** none remaining.

**Type consistency:** `CodemodeLimits`, `runCodemode`, `createExecuteTool(ctx, siblings, limits)`, `CODEMODE_MAX_CONCURRENCY = 8` are named the same in every task.
