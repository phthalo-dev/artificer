# Role Customization Design

**Date:** 2026-06-28
**Status:** Approved

## Summary

Allow identity code to define, override, and fully author roles — including system prompts and tool sets — so an agent's behavior is configurable without touching the runtime source. The orchestrator's own prompt drives the workstream state machine; custom roles are spawn targets it can invoke via `invoke_call`.

---

## Identity Directory Structure

A new `agent/roles/` folder is added to the identity directory. Each file is `<slug>.md`.

```
agent/
  instructions.md          ← global suffix appended to ALL role system prompts (now wired)
  roles/
    worker.md              ← overrides built-in "worker" role
    security-auditor.md    ← new custom role the orchestrator can spawn
  tools/
  skills/
```

### Role file format

```markdown
---
name: Security Auditor
blurb: Reviews code for security vulnerabilities.
baseRole: reviewer
---

You are {{agentName}}'s SECURITY AUDITOR. Focus exclusively on...
```

### Frontmatter fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | No | Built-in name or slug | Human-facing label used in status snapshots |
| `blurb` | No | Built-in blurb or empty | One-line description |
| `baseRole` | No | `worker` | Which built-in role's tool set to inherit: `communicator \| orchestrator \| planner \| worker \| reviewer \| librarian` |

The `{{agentName}}` placeholder in the body is substituted at call time with the configured agent name.

If the slug matches a built-in role name (e.g. `worker.md`), it overrides that role's system prompt and blurb. A new slug (e.g. `security-auditor.md`) registers a new role the orchestrator can spawn via `invoke_call`.

---

## Runtime Architecture

### RoleRegistry

A new class `RoleRegistry` in `packages/runtime/src/engine/role-registry.ts`:

1. Initializes with the 6 built-in `RoleDefinition` objects from `roles.ts`
2. Merges identity-provided roles at startup: built-in slugs are replaced, new slugs are added
3. Exposes `getRole(name: string): RoleDefinition | undefined`
4. Exposes `listRoleNames(): string[]` for error messages and tooling

### Loading

`scanAgentDirectory` in `discover/discover.ts` is extended to scan `agent/roles/*.md` and return them as a new `roles: ModuleRef[]` field on `AgentManifest`.

A new `loadRolesFromDisk(refs: ModuleRef[]): RoleDefinition[]` function in `discover/loader.ts` parses each file: reads frontmatter for `name`, `blurb`, `baseRole`; substitution of `{{agentName}}` happens at call time (not load time). Invalid `baseRole` values log a warning and fall back to `worker`.

`create-runtime.ts` constructs a `RoleRegistry` from the built-ins plus any loaded identity roles, and passes it to `Engine`.

### globalInstructions

`instructions` is already loaded in `create-runtime.ts` but currently unused. It is now stored as `globalInstructions?: string` on `RuntimeConfig` and passed through to `executeCall`.

### Threading

`RoleRegistry` is passed into `Engine` via its constructor and forwarded into `executeCall` deps, replacing the current static `getRole` import from `roles.ts`.

`RoleName` stays as the strict `'communicator' | 'orchestrator' | 'planner' | 'worker' | 'reviewer' | 'librarian'` union for the places engine logic references built-in roles directly (model tier lookup, task creation gating). `spawnCall` and the `invoke_call` tool are widened to accept `string` for role name; the registry validates at invocation time.

`RunRecord.role` in `storage/types.ts` is widened from `RoleName` to `string` so custom role names can be persisted and read back. All engine-internal switches on `run.role` that care about built-in behavior (e.g. `WORK_ROLES.has(run.role)`) continue to work — they compare against string literals, so no type-level change is needed there beyond the field type.

---

## Call Execution

### System prompt composition

```
role.system(agentName)        ← role body with {{agentName}} substituted
+ "\n\n" + globalInstructions ← agent/instructions.md content (if present)
```

Global instructions are appended last so they don't interrupt the role's own structure.

### Tool resolution

`toolsForRole` in `tools/registry.ts` is updated to accept a `baseRole` parameter. Custom roles pass their declared `baseRole` (defaulting to `worker`); built-in overrides pass their own slug. The internal switch statement over `RoleName` is unchanged.

### Error handling

If `invoke_call` is called with an unknown role name, `registry.getRole` returns `undefined` and the tool returns a clear error to the model:

```
Unknown role: 'foo'. Available roles: communicator, orchestrator, worker, security-auditor, …
```

No run record is created for an unknown role.

If a role file has an invalid `baseRole`, the runtime logs a warning at startup and falls back to `worker`. The agent does not crash.

---

## Testing

### RoleRegistry unit tests

- Built-ins load correctly and all 6 are present
- Identity file overrides a built-in's system prompt and blurb
- New role slug is discoverable via `getRole` and `listRoleNames`
- `baseRole` defaults to `worker` when omitted from frontmatter
- Unknown `baseRole` in frontmatter falls back to `worker` with a warning
- `getRole` returns `undefined` for unknown names

### loadRolesFromDisk unit tests

- Valid frontmatter parses `name`, `blurb`, and `baseRole` correctly
- `{{agentName}}` in body is preserved at load time (substituted at call time)
- Missing frontmatter fields use correct defaults
- Malformed frontmatter is skipped gracefully (no crash)

### executeCall integration

- Existing engine tests pass unchanged (built-ins still work)
- Engine constructed with an overridden `worker` role passes the custom system prompt to `runToolLoop`
- `globalInstructions` appears appended in the composed system string

---

## Out of Scope

- TypeScript role modules (`.ts` exports) — markdown covers all use cases
- Custom roles defining new state machine slots — the orchestrator prompt drives flow
- Per-role tool allow/block lists beyond `baseRole` inheritance
