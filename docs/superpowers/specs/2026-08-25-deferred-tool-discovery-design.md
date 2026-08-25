# Deferred Tool Discovery — Design

**Date:** 2026-08-25
**Status:** Approved for planning
**Component:** `packages/runtime` (tools, skills, future MCP connections)
**Related:**
- [Frozen per-call tool plan](./2026-08-25-frozen-tool-plan-design.md) (prerequisite)
- [Artificer vs. Codex comparison](../../research/2026-08-24-codex-comparison.md) (Tier 1 borrow #5)
- Existing stubs: `defineSkill`, `defineConnection`, `defineTool`; skills loaded onto `runtime.skills` but unused; connections API-only

## Purpose

Prevent tool-schema explosion when identity custom tools, skills, and (later) MCP/OpenAPI connections come online. Keep a **small always-on catalog** for the model, and put everything else behind **search + explicit load/call** tools. Aligns with Codex `tool_search` / deferred namespaces without requiring mid-loop mutation of the AI SDK tool map.

## Problem

Once [frozen tool plan](./2026-08-25-frozen-tool-plan-design.md) wires custom tools into `executeCall`, every schema pays token tax on every worker/planner call. Skills are already loaded into `runtime.skills` and never injected — the wrong default once we “fix” that is to dump all skill bodies into the system prompt. MCP via `defineConnection` will be worse (tens of tools per server).

Codex defers large surfaces and exposes `tool_search`. Artificer’s AI SDK `runToolLoop` fixes tools at call start, so **promoting** a deferred tool into the model-visible `tools` map mid-call is a poor fit. Use a **gateway** instead.

## Decisions

- **Prerequisite:** frozen tool plan + live `customRegistry` wiring ships first (or in the same change set, plan types include `deferred`).
- **Always-on:** built-ins for the role + `execute` / `wait_execute` (if present) + discovery tools below + custom tools **until** a soft cap.
- **Soft cap:** if custom `defineTool` count for the role exceeds `ALWAYS_ON_CUSTOM_TOOL_CAP` (default **8**), overflow goes to the deferred catalog. Built-ins never deferred.
- **Gateway pattern for deferred tools:** model-visible `search_tools` + `call_deferred_tool`. Deferred tools are **not** individually listed in the AI SDK tools array and **not** installed as codemode `tools.<name>` siblings.
- **Skills are content, not tools:** `search_skills` + `load_skill` return markdown into the tool result (pull), never auto-inject all skills into the system prompt. Matches `query_memories` pull style.
- **MCP/OpenAPI:** v1 of this spec defines the deferred catalog interface and a **null/empty MCP adapter**. A follow-up implements `defineConnection` runtime against the same `DeferredToolCatalog`. Do not block skills/custom overflow on MCP.
- **No `CodeModeOnly`.** Codemode siblings = always-on tools minus execute/wait/discovery-tools that are host-only… Decision: **discovery tools are always-on for the model but not installed as codemode siblings** (`search_tools`, `call_deferred_tool`, `search_skills`, `load_skill` excluded from guest `tools`, same as nesting prevention for `execute`).

## Architecture

```
createToolPlan(...)
    │
    ├─ builtIns = toolsForRole built-ins (no custom yet)
    ├─ custom = customRegistry.toolsForRole(role)
    ├─ alwaysOnCustom = custom.slice(0, CAP)
    ├─ deferredCustom = custom.slice(CAP)
    ├─ skills → deferred skill index (name, description only)
    ├─ connections → deferred MCP ops (empty until MCP ships)
    │
    ├─ alwaysOn = builtIns
    │            + alwaysOnCustom
    │            + discovery tools (search_tools, call_deferred_tool, search_skills, load_skill)
    │            + execute/wait if role allows
    │
    └─ plan.deferred = { tools: Map, skills: Map, search(), call() }
```

```
model ──search_tools({ query, limit? })──▶ ranked { name, description, source }[]
model ──call_deferred_tool({ name, input })──▶ plan.deferred.call(name, input)
model ──search_skills({ query })──▶ { name, description }[]
model ──load_skill({ name })──▶ { name, description, content }
```

### Deferred tool entry

```ts
export type DeferredToolSource = 'custom' | 'mcp' | 'openapi';

export type DeferredToolEntry = {
  name: string;          // globally unique within the plan; MCP prefixed e.g. mcp__server__tool
  description: string;
  source: DeferredToolSource;
  inputSchema: unknown;  // JSON schema for search detail / validation
  execute: (input: unknown, ctx: ToolContext) => Promise<string>;
  roles: RoleName[];     // already filtered at plan build
};
```

### Discovery tool contracts

**`search_tools`**

```ts
input: { query: string; limit?: number }  // default limit 8, max 20
output: JSON array of {
  name, description, source,
  // include condensed schema property names (not full schema) in v1 to save tokens
  inputKeys: string[];
}
```

Ranking: simple case-insensitive substring on name/description; stable sort by name. No embeddings in v1.

**`call_deferred_tool`**

```ts
input: { name: string; input: unknown }
output: string from entry.execute, or structured error if unknown / wrong role / approval denied
```

Runs through the same approval enforcement as always-on tools.

**`search_skills` / `load_skill`**

- Index from `runtime.skills` (markdown skills already loaded).
- `load_skill` returns full `content` once; does not permanently alter system prompt.
- Unknown name → clear error string.

### Role access

| Tool | Roles |
|---|---|
| `search_tools` / `call_deferred_tool` | Roles that can have deferred custom/MCP tools: at least `worker`, `orchestrator`, `planner`; include others only if they receive deferred entries |
| `search_skills` / `load_skill` | All roles that benefit from identity skills: `communicator`, `planner`, `worker`, `reviewer`, `orchestrator`, `librarian` (skills are cheap metadata until loaded) |

If a role has zero deferred tools, still expose `search_tools` (returns empty) **or** omit discovery tools when deferred map empty — **prefer omit when empty** to save schema tokens; always expose skill tools if `runtime.skills.length > 0`.

### Codemode

Guest `tools` siblings = always-on **handler** tools only (files, shell, edit, custom always-on, …). Not installed: `execute`, `wait_execute`, `search_*`, `load_skill`, `call_deferred_tool`.

To use a deferred tool from codemode, the model must call `call_deferred_tool` in the **outer** loop (or we later add a guest gateway — **non-goal for v1**). Document this limitation in the execute tool description one-liner.

## Components

| Unit | Path | Responsibility |
|---|---|---|
| Deferred catalog | `tools/deferred-catalog.ts` (new) | Store entries, search, call |
| Discovery tools | `tools/discovery.ts` (new) | `search_tools`, `call_deferred_tool`, skill tools |
| Tool plan | `tools/tool-plan.ts` | Cap custom always-on; attach deferred; omit empty discovery |
| Skills | already on runtime | Index into deferred skills map at plan build |
| Config | `config.ts` | `RUNTIME_ALWAYS_ON_CUSTOM_TOOL_CAP` (default 8) |
| MCP (stub) | `connections/` or `tools/mcp-stub.ts` | Empty register function; real client follow-up |

## Testing

- 10 custom tools + cap 8 → 8 always-on, 2 deferred; `search_tools` finds overflow; `call_deferred_tool` executes it.
- `search_tools` does not return always-on built-in names (or does — **decide: search covers deferred only** to avoid duplication). **Deferred only.**
- Skills: search/load round-trip from fixture markdown.
- Approval: deferred tool with `needsApproval` hits policy enforcement.
- Codemode siblings exclude discovery tools.
- Cap env override honored.

## Docs

- Update custom tools guide: overflow past cap becomes deferred; how to search/call.
- Skills guide: pull via `load_skill`, not auto-injected.
- MCP: document that connections will register into the deferred catalog when implemented.

## Non-goals

- Mid-call promotion into AI SDK `tools` map
- Embeddings for tool search
- Codemode guest access to deferred tools in v1
- Full MCP client implementation (interface only)
- Auto-injecting skill content into system prompts
- `$codemode.search` inside the guest (explicit non-goal of codemode v1; still deferred)

## Constraints

- Deferred names must not collide with always-on names; on collision, always-on wins and deferred entry is dropped with a warning.
- `call_deferred_tool` input validated lightly (presence); full JSON-schema validation can be ajv-or-zod later — v1 may trust the tool’s own zod parse inside `execute`.
- Discovery tools themselves never appear in the deferred catalog.
- Frozen plan invariant: deferred **entries** are fixed at call start; MCP servers are not hot-plugged mid-call in v1.
