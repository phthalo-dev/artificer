# Frozen Per-Call Tool Plan — Design

**Date:** 2026-08-25
**Status:** Approved for planning
**Component:** `packages/runtime` (`engine/call.ts`, `tools/registry.ts`, `codemode/`)
**Related:**
- [Codemode v1 design](./2026-08-17-codemode-batched-tool-orchestration-design.md)
- [Codemode v2 yield/wait](./2026-08-25-codemode-yield-wait-design.md) (depends on freeze for cell lifetime)
- [Deferred tool discovery](./2026-08-25-deferred-tool-discovery-design.md) (builds on this snapshot)
- [Artificer vs. Codex comparison](../../research/2026-08-24-codex-comparison.md) (Tier 1 borrow #2 — Codex `StepContext`)

## Purpose

Make the tool catalog visible to a role call — including the sibling set offered to `execute` — a **snapshot taken once at call start**, immutable for the life of that call (outer `runToolLoop` + any codemode cells). Prevent mid-call authority drift from registry reloads, config changes, or future dynamic tool promotion.

Also close the existing hole where `createRuntime` builds a `ToolRegistry` but `executeCall` never passes it into `toolsForRole`.

## Problem

Today:

1. `executeCall` → `toolsForRole(role, ctx)` with **no** `customRegistry`, so identity `agent/tools` never reach the live loop.
2. `createExecuteTool(ctx, siblings, limits)` closes over whatever array was built at registry time — fine for one-shot v1, but after yield/wait cells and deferred-tool promotion, any re-read of a live registry mid-call could change which handlers a guest can invoke.
3. Codex’s `StepContext` freezes `tool_router` + MCP bindings per sampling request for exactly this reason.

Artificer does not need a full StepContext type. It needs a **call-scoped frozen plan** object.

## Decisions

- **One snapshot per `executeCall`**, not per model sampling step inside `runToolLoop`. Artificer’s AI SDK loop does not re-advertise tools mid-call today; freezing once at call start matches reality and is enough for codemode cells that outlive a single `execute` tool invocation.
- **Wire `customRegistry` on the live path** as part of this work (prerequisite for identity tools + deferred discovery). Discovery/load of `agent/tools/*.ts` into that registry is in scope for the *wiring* so the freeze is meaningful; full deferred promotion rules live in the deferred-tool spec.
- **Freeze includes handler closures**, not just names. The guest and `runToolLoop` use the same `ToolDef[]` references.
- **Deferred promotion (later)** may add entries only through an explicit call-plan API that appends to a *mutable side table* for the deferred gateway — never by mutating the frozen always-on `ToolDef[]` advertised to the model. See deferred-tool spec.

## Architecture

```
executeCall(...)
    │
    ├─ plan = createToolPlan({ role, ctx, customRegistry, deferredCatalog? })
    │         // ToolDef[] alwaysOn — Object.freeze / readonly
    │         // DeferredCatalog handle (opaque) for search/call_deferred
    │
    ├─ ctx = { ...ctx, toolPlan: plan }
    │
    └─ runToolLoop({ tools: plan.alwaysOn, ... })
              │
              └─ execute / wait_execute / call_deferred
                     read siblings & deferred ONLY from ctx.toolPlan
```

```ts
// packages/runtime/src/tools/tool-plan.ts
export type ToolPlan = {
  role: RoleName;
  /** Model-visible tools for this call. Immutable after createToolPlan. */
  alwaysOn: readonly ToolDef[];
  /** Names frozen for assertions / logging. */
  alwaysOnNames: readonly string[];
  /**
   * Deferred catalog (may be empty until deferred-tool discovery ships).
   * Mutable only via plan.promote / plan lookups — not via toolsForRole again.
   */
  deferred: DeferredToolCatalog;
};

export function createToolPlan(args: {
  role: RoleName;
  ctx: ToolContext;
  customRegistry?: ToolRegistry;
  // deferred sources added by deferred-tool spec
}): ToolPlan;
```

`toolsForRole` becomes an implementation detail used **only** inside `createToolPlan` (or `createToolPlan` inlines the same switch). Public tests may still call `toolsForRole` for unit convenience, but `executeCall` must not.

### Codemode interaction

- `createExecuteTool` takes `plan.alwaysOn` filtered to siblings (everything except `execute` / `wait_execute`), not a freshly built list.
- Cell resume uses the same sibling handlers from the plan captured at cell creation (cell stores `plan` reference or sibling array).
- Quota failover / model switch mid-run (if any) must **not** rebuild the plan for an in-flight call. A *new* `executeCall` (new run) builds a new plan.

## Components

| Unit | Path | Responsibility |
|---|---|---|
| Tool plan | `packages/runtime/src/tools/tool-plan.ts` (new) | `createToolPlan`, types, freeze helper |
| Registry | `tools/registry.ts` | Keep `toolsForRole`; used by plan builder |
| Call path | `engine/call.ts` | Build plan once; pass `plan.alwaysOn` to loop; put plan on ctx |
| Create runtime | `api/create-runtime.ts` | Load identity tools into `ToolRegistry` (see below); pass registry into engine/call |
| Execute / wait | `tools/execute.ts`, `wait-execute.ts` | Consume `ctx.toolPlan` |
| Context type | `context.ts` | `toolPlan?: ToolPlan` on `ToolContext` |

### Identity tool loading (live wiring)

Minimal load path (this spec, not deferred):

1. `scanAgentDirectory` already lists `agent/tools/*.ts`.
2. `createRuntime` dynamically imports each module’s default/`defineTool` export into `runtime.tools` (`ToolRegistry.register`).
3. Engine / `executeCall` receives `customRegistry: runtime.tools`.

Failure to import a tool file: log error, skip that tool, continue startup (same spirit as channel load failures). Do not crash the process.

Skills and MCP connections are **not** loaded as always-on tools here — that is the deferred-tool spec. Custom `defineTool` modules are always-on in this spec (usually few). If an identity ships dozens of custom tools, deferred-tool discovery will later move overflow behind the gateway; v1 of *this* spec can document a soft warning when `alwaysOn.length > 40` (or similar) without enforcing.

## Observability

- Log once per call at debug: `toolPlan role=… alwaysOn=N names=[…]`.
- No new RuntimeEvent kind required.

## Testing

- `executeCall` with a registered custom tool → model-facing catalog includes it (integration with fake model or unit-level plan assertion).
- Plan `alwaysOn` is frozen: attempt to push throws / is a no-op under `readonly` typing + runtime `Object.freeze`.
- Codemode siblings equal `alwaysOn` minus execute/wait tools, same handler references.
- Two sequential `executeCall`s after `registry.register` mid-process: second call sees new tool; first call’s in-flight cell (if tested) does not.
- `createRuntime` loads a fixture `agent/tools/foo.ts` into the registry.

## Docs

- `docs/guides/writing-custom-tools.md`: state that custom tools are now loaded on the live path.
- Note the freeze invariant for anyone extending the call path.

## Non-goals

- Freezing model id, approval policy, or MCP bindings in a full StepContext clone (approval policy is a separate spec; MCP is deferred-tool).
- Rebuilding tools per sampling step inside `runToolLoop`.
- Hot-reload of `agent/tools` mid-process without a new call.
- Moving custom tools behind deferred search (follow-up spec).

## Constraints

- External executors still ignore Artificer tool plans (they use their own tools).
- `execute` remains reserved; custom tools named `execute` / `wait_execute` are skipped with a warning.
- This spec should land **before** or **with** codemode v2 cells so cells capture a stable sibling map.
