# Frozen Per-Call Tool Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot the role’s tool catalog once per `executeCall`, wire identity `agent/tools` into the live path, and make that snapshot the only source of handlers for `runToolLoop` and codemode siblings.

**Architecture:** `createToolPlan()` calls `toolsForRole` once, freezes `alwaysOn`, and attaches a (initially empty) `DeferredToolCatalog`. `executeCall` builds the plan, puts it on `ToolContext`, and passes `plan.alwaysOn` into the loop. `createRuntime` loads `agent/tools/*.ts` into `ToolRegistry` and the engine passes that registry into `executeCall`.

**Tech Stack:** TypeScript ESM, Node `node:test` + `node:assert/strict`, existing `ToolDef` / `ToolRegistry` / `toolsForRole`.

**Spec:** [docs/superpowers/specs/2026-08-25-frozen-tool-plan-design.md](../specs/2026-08-25-frozen-tool-plan-design.md)

## Global Constraints

- One snapshot per `executeCall`, not per sampling step inside `runToolLoop`.
- Freeze includes handler closures (same `ToolDef` references), not just names.
- Custom tools named `execute` / `wait_execute` are skipped with a warning (existing `execute` skip; extend for `wait_execute` when that tool exists).
- External `WorkerExecutor` paths ignore Artificer tool plans.
- Do not implement deferred search/call in this plan (empty deferred catalog only).
- Soft warn when `alwaysOn.length > 40`; do not enforce a hard fail.

## File map

| File | Responsibility |
|---|---|
| `packages/runtime/src/tools/deferred-catalog.ts` | Minimal empty catalog type used by `ToolPlan` |
| `packages/runtime/src/tools/tool-plan.ts` | `createToolPlan`, freeze helper |
| `packages/runtime/src/context.ts` | `toolPlan?: ToolPlan` on `ToolContext` |
| `packages/runtime/src/engine/call.ts` | Build plan; pass `alwaysOn`; accept `customRegistry` |
| `packages/runtime/src/engine/engine.ts` | Thread `customRegistry` / `tools` into `executeCall` |
| `packages/runtime/src/discover/loader.ts` | `loadToolsFromDisk` |
| `packages/runtime/src/api/create-runtime.ts` | Load tools into `ToolRegistry` |
| `packages/runtime/src/tools/execute.ts` | Prefer `ctx.toolPlan` for siblings when present |
| Tests | `tool-plan.test.ts`, loader/registry/call tests as listed |

---

### Task 1: `DeferredToolCatalog` stub + `createToolPlan`

**Files:**
- Create: `packages/runtime/src/tools/deferred-catalog.ts`
- Create: `packages/runtime/src/tools/tool-plan.ts`
- Test: `packages/runtime/src/tools/tool-plan.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // deferred-catalog.ts
  export type DeferredToolCatalog = {
    size: number;
    has(name: string): boolean;
  };
  export function emptyDeferredCatalog(): DeferredToolCatalog;

  // tool-plan.ts
  export type ToolPlan = {
    role: string;
    alwaysOn: readonly ToolDef[];
    alwaysOnNames: readonly string[];
    deferred: DeferredToolCatalog;
  };
  export function createToolPlan(args: {
    role: string;
    ctx: ToolContext;
    customRegistry?: ToolRegistry;
  }): ToolPlan;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/runtime/src/tools/tool-plan.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToolPlan } from './tool-plan.js';
import type { ToolContext } from '../context.js';

function fakeCtx(): ToolContext {
  return {
    engine: {
      config: {
        codemode: { timeoutMs: 120_000, maxToolCalls: 32, maxOutputBytes: 12_000 },
      },
    },
    workspaceDir: '/tmp',
  } as unknown as ToolContext;
}

test('createToolPlan freezes alwaysOn and lists names', () => {
  const plan = createToolPlan({ role: 'worker', ctx: fakeCtx() });
  assert.ok(plan.alwaysOn.length > 0);
  assert.deepEqual(
    plan.alwaysOnNames,
    plan.alwaysOn.map((t) => t.name),
  );
  assert.throws(() => {
    (plan.alwaysOn as ToolDef[]).push({
      name: 'x',
      description: '',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => '',
    });
  });
  assert.equal(plan.deferred.size, 0);
});
```

(Import `ToolDef` in the test file for the cast.)

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd packages/runtime && node --import tsx --test src/tools/tool-plan.test.ts`

- [ ] **Step 3: Implement stub catalog + `createToolPlan`**

```ts
// deferred-catalog.ts
export type DeferredToolCatalog = {
  size: number;
  has(name: string): boolean;
};

export function emptyDeferredCatalog(): DeferredToolCatalog {
  return {
    size: 0,
    has() {
      return false;
    },
  };
}
```

```ts
// tool-plan.ts
import type { ToolContext } from '../context.js';
import type { ToolRegistry } from '../api/tool-registry.js';
import type { ToolDef } from '../llm/types.js';
import { emptyDeferredCatalog, type DeferredToolCatalog } from './deferred-catalog.js';
import { toolsForRole } from './registry.js';

export type ToolPlan = {
  role: string;
  alwaysOn: readonly ToolDef[];
  alwaysOnNames: readonly string[];
  deferred: DeferredToolCatalog;
};

export function createToolPlan(args: {
  role: string;
  ctx: ToolContext;
  customRegistry?: ToolRegistry;
}): ToolPlan {
  const tools = toolsForRole(args.role, args.ctx, args.customRegistry);
  const alwaysOn = Object.freeze([...tools]) as readonly ToolDef[];
  if (alwaysOn.length > 40) {
    console.warn(
      `[artificer] tool plan for role "${args.role}" has ${alwaysOn.length} always-on tools (>40); consider deferred discovery`,
    );
  }
  return {
    role: args.role,
    alwaysOn,
    alwaysOnNames: Object.freeze(alwaysOn.map((t) => t.name)),
    deferred: emptyDeferredCatalog(),
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/tools/deferred-catalog.ts packages/runtime/src/tools/tool-plan.ts packages/runtime/src/tools/tool-plan.test.ts
git commit -m "$(cat <<'EOF'
feat(runtime): add createToolPlan with frozen always-on tools

EOF
)"
```

---

### Task 2: Load identity tools + thread registry into `executeCall`

**Files:**
- Modify: `packages/runtime/src/discover/loader.ts`
- Modify: `packages/runtime/src/api/create-runtime.ts`
- Modify: `packages/runtime/src/context.ts` — add `toolPlan?: ToolPlan`
- Modify: `packages/runtime/src/engine/call.ts` — `ExecuteCallDeps.customRegistry?`, use `createToolPlan`
- Modify: `packages/runtime/src/engine/engine.ts` — pass `this` runtime tools / deps
- Modify: `packages/runtime/src/tools/execute.ts` — siblings from `ctx.toolPlan` when set
- Test: `packages/runtime/src/discover/loader.test.ts` (new or extend), `packages/runtime/src/tools/tool-plan.test.ts` (custom registry), existing `registry.test.ts` still green

**Interfaces:**
- Produces: `loadToolsFromDisk(refs: ModuleRef[]): Promise<ArtificerTool[]>`
- `ExecuteCallDeps` gains `customRegistry?: ToolRegistry`
- `executeCall` sets `ctx.toolPlan = plan` and `runToolLoop({ tools: plan.alwaysOn, ... })`

- [ ] **Step 1: Write failing loader + plan-with-custom tests**

```ts
test('loadToolsFromDisk registers defineTool default exports', async () => {
  // write temp agent/tools/echo.ts that default-exports defineTool({...})
  // loadToolsFromDisk → one ArtificerTool named echo
});

test('createToolPlan includes custom registry tools for worker', () => {
  const registry = new ToolRegistry();
  registry.register(defineTool({
    name: 'echo_custom',
    description: 'echo',
    input: { type: 'object', properties: {} },
    roles: ['worker'],
    execute: async () => 'ok',
  }));
  const plan = createToolPlan({ role: 'worker', ctx: fakeCtx(), customRegistry: registry });
  assert.ok(plan.alwaysOnNames.includes('echo_custom'));
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `loadToolsFromDisk`** (mirror `loadChannelsFromDisk`: dynamic import, accept `ArtificerTool` via `name` + `toToolDef` + `definition`, warn/skip on failure)

- [ ] **Step 4: Wire `createRuntime`** — after skills load:
  ```ts
  const tools = new ToolRegistry();
  for (const t of await loadToolsFromDisk(manifest.tools)) {
    tools.register(t);
  }
  // attach tools to returned ArtificerRuntime (already has tools: new ToolRegistry() — replace)
  ```

- [ ] **Step 5: Wire `executeCall`**
  ```ts
  const plan = createToolPlan({
    role: effectiveBaseRole,
    ctx,
    customRegistry: deps.customRegistry,
  });
  ctx.toolPlan = plan;
  // later: runToolLoop({ tools: [...plan.alwaysOn], ... })
  ```
  Thread `customRegistry` from Engine (store on Engine constructor or ExecuteCallDeps from the place that calls `executeCall`).

- [ ] **Step 6: `createExecuteTool`** — if `ctx.toolPlan`, siblings = `plan.alwaysOn.filter(t => t.name !== 'execute' && t.name !== 'wait_execute')`; else keep current behavior for unit tests that call `toolsForRole` directly.

- [ ] **Step 7: Run affected tests**

```bash
cd packages/runtime && node --import tsx --test \
  src/tools/tool-plan.test.ts \
  src/tools/registry.test.ts \
  src/discover/loader.test.ts
```

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): wire identity tools through frozen tool plans

EOF
)"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/guides/writing-custom-tools.md`

- [ ] **Step 1:** Document that `agent/tools/*.ts` are loaded on startup and appear on the live call path; mention the freeze invariant (catalog fixed for the life of a call).

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: note live loading of identity custom tools

EOF
)"
```

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `createToolPlan` + freeze | 1 |
| Empty deferred catalog placeholder | 1 |
| Wire `customRegistry` live path | 2 |
| Load `agent/tools` | 2 |
| `ctx.toolPlan` + loop uses snapshot | 2 |
| Execute siblings from plan | 2 |
| Soft warn >40 tools | 1 |
| Docs | 3 |
