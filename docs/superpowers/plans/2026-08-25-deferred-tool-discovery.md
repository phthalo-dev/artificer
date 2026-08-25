# Deferred Tool Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a small always-on tool catalog; overflow custom tools and all skills go behind search/load/call gateways so schema tokens stay bounded. Stub the deferred catalog so MCP can register later.

**Architecture:** Extend `createToolPlan` to cap always-on custom tools, populate `DeferredToolCatalog` with overflow + skill index, and append discovery tools (`search_tools`, `call_deferred_tool`, `search_skills`, `load_skill`) when needed. Discovery tools are never codemode siblings.

**Tech Stack:** TypeScript ESM, existing `ToolRegistry` / skills loader, Node `node:test`.

**Spec:** [docs/superpowers/specs/2026-08-25-deferred-tool-discovery-design.md](../specs/2026-08-25-deferred-tool-discovery-design.md)

**Depends on:** [Frozen tool plan](./2026-08-25-frozen-tool-plan.md) (must land first).

## Global Constraints

- Built-ins never deferred.
- Soft cap default **8** custom always-on tools (`RUNTIME_ALWAYS_ON_CUSTOM_TOOL_CAP`).
- `search_tools` returns **deferred only** (not always-on names).
- No mid-call promotion into the AI SDK tools map — gateway only.
- No embeddings; substring rank, stable name sort.
- No codemode guest access to deferred tools in v1.
- MCP client not implemented — empty register hook only.
- Name collisions: always-on wins; drop deferred duplicate with warning.
- Omit tool-discovery pair when deferred tool map empty; expose skill tools only if `skills.length > 0`.

## File map

| File | Responsibility |
|---|---|
| `packages/runtime/src/config.ts` | `alwaysOnCustomToolCap` |
| `packages/runtime/src/tools/deferred-catalog.ts` | Full catalog (replace stub) |
| `packages/runtime/src/tools/discovery.ts` | Four discovery tools |
| `packages/runtime/src/tools/tool-plan.ts` | Cap, skills index, attach discovery tools |
| `packages/runtime/src/engine/call.ts` / `create-runtime` | Pass skills into plan builder |
| `packages/runtime/src/tools/execute.ts` | Exclude discovery tool names from siblings |
| Docs | custom tools + skills guides |

---

### Task 1: Real `DeferredToolCatalog` + config cap

**Files:**
- Modify: `packages/runtime/src/tools/deferred-catalog.ts`
- Modify: `packages/runtime/src/config.ts`, `config.test.ts`
- Test: `packages/runtime/src/tools/deferred-catalog.test.ts`

**Interfaces:**
```ts
export type DeferredToolSource = 'custom' | 'mcp' | 'openapi';

export type DeferredToolEntry = {
  name: string;
  description: string;
  source: DeferredToolSource;
  inputSchema: unknown;
  execute: (input: unknown, ctx: ToolContext) => Promise<string>;
};

export type DeferredSkillEntry = {
  name: string;
  description: string;
  content: string;
};

export type DeferredToolCatalog = {
  readonly size: number;
  has(name: string): boolean;
  registerTool(entry: DeferredToolEntry): void;
  registerSkill(entry: DeferredSkillEntry): void;
  searchTools(query: string, limit: number): Array<{
    name: string;
    description: string;
    source: DeferredToolSource;
    inputKeys: string[];
  }>;
  callTool(name: string, input: unknown, ctx: ToolContext): Promise<string>;
  searchSkills(query: string, limit: number): Array<{ name: string; description: string }>;
  loadSkill(name: string): DeferredSkillEntry | undefined;
};

export function createDeferredCatalog(): DeferredToolCatalog;
```

- [ ] **Step 1: Failing tests** — register 2 tools; search finds by substring; call executes; unknown call returns error string; skill search/load; duplicate registerTool same name keeps first + warns.

- [ ] **Step 2: Implement + config parse for cap (default 8)**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): implement deferred tool/skill catalog

EOF
)"
```

---

### Task 2: Discovery tools + plan wiring

**Files:**
- Create: `packages/runtime/src/tools/discovery.ts`
- Modify: `tool-plan.ts`, `execute.ts`, `call.ts` / engine deps to pass `skills: ArtificerSkill[]` and cap from config
- Test: `discovery.test.ts`, extend `tool-plan.test.ts`

**Interfaces:**
```ts
export function createDiscoveryTools(args: {
  ctx: ToolContext;
  plan: ToolPlan; // or catalog + getters
}): ToolDef[]; // 0–4 tools depending on catalog contents
```

`createToolPlan` algorithm:
1. Build built-ins via internal split **or** call `toolsForRole` without custom, then merge custom separately. Cleanest approach:
   - Refactor `toolsForRole` to accept options `{ includeExecute?: boolean; customRegistry? }` **or**
   - In `createToolPlan`: get built-ins with `customRegistry: undefined`, get customs from registry, slice customs at cap, convert overflow to deferred entries (`execute` via `toToolDef(ctx).handler` wrapped to `(input, ctx) => handler(input)`).
2. Register skills into catalog.
3. Compose `alwaysOn = builtIns + alwaysOnCustom + discoveryTools + execute/wait`.
4. Freeze.

Discovery tool schemas per spec. `call_deferred_tool` must run `enforceApproval` if approval plan has landed — if approval not merged yet, call handler directly and add a follow-up note in plan self-review; prefer depending on approval’s `enforceApproval` when both merge.

- [ ] **Step 1: Failing tests**
  - 10 custom tools, cap 8 → 8 names always-on, 2 searchable deferred
  - `search_tools` does not list `read_file`
  - `call_deferred_tool` returns overflow tool output
  - skills: `load_skill` returns content
  - execute siblings exclude `search_tools`, `call_deferred_tool`, `search_skills`, `load_skill`
  - no skills + no deferred → discovery tools absent from alwaysOn

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): add deferred tool discovery gateways

EOF
)"
```

---

### Task 3: MCP stub hook + docs

**Files:**
- Create: `packages/runtime/src/tools/mcp-deferred-stub.ts` (or comment + exported `registerConnectionTools(catalog, connection): void` no-op)
- Modify: `docs/guides/writing-custom-tools.md`, skills docs if present

- [ ] **Step 1:** Export `registerConnectionTools` that throws or no-ops with JSDoc “MCP client not implemented”.
- [ ] **Step 2:** Docs — cap, search/call, skills pull model, MCP future.
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: document deferred tool discovery and skill loading

EOF
)"
```

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Cap + overflow to deferred | 2 |
| Deferred catalog API | 1 |
| search/call tools | 2 |
| skills search/load | 2 |
| Omit empty discovery | 2 |
| Codemode sibling exclusion | 2 |
| MCP stub | 3 |
| Config env | 1 |
| Docs | 3 |
