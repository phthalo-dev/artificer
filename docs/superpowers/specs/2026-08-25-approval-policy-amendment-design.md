# Approval → Durable Policy Amendment — Design

**Date:** 2026-08-25
**Status:** Approved for planning
**Component:** `packages/runtime` (tools, storage, server/API, optional UI)
**Related:**
- [Artificer vs. Codex comparison](../../research/2026-08-24-codex-comparison.md) (Tier 1 borrow #3)
- Existing `needsApproval` on `ToolDefinition` (`api/types.ts`) — declared, never enforced
- Existing hard denies in `tools/shell-policy.ts`

## Purpose

Enforce `needsApproval` for dangerous tool invocations, and when a human (or an explicit allow rule) approves an action, **persist a reusable policy amendment** so the autonomous agent does not re-prompt for the same class of action. Prefer durable rules over interactive IDE-style approval modals.

## Problem

- `needsApproval?: boolean | ((input) => boolean)` exists on `ToolDefinition` but is dropped in `toToolDef` and never checked.
- Shell policy only returns hard deny strings (`checkGitCloneInWorkspace`, `checkReviewerWrite`, `checkGitStash`) — there is no allowlist learning path.
- Artificer is an unattended colleague: blocking every `npm install` on a human is the wrong default, but silently running destructive/network actions with no policy memory is also wrong.
- Codex’s valuable idea is not the modal — it is `ReviewDecision` variants that **amend execpolicy / session allowlists**.

## Decisions

- **Two layers stay distinct:**
  1. **Hard policy** (`shell-policy.ts` and friends) — unconditional deny; unchanged.
  2. **Approval policy** — soft gate for `needsApproval` tools/inputs; deny-by-default when no matching allow rule exists (autonomous-safe), with a path to add rules.
- **Default outcome when gated and no rule:** return a structured tool error to the model (do not hang the run). Emit a `RuntimeEvent` so the UI/API can show a pending suggestion. Humans add rules via API (and later UI); the model may retry after a rule appears **on a later call** (not mid-handler spin-wait).
- **No Guardian LLM in v1** (Tier 2 in the Codex research).
- **Persistence:** exec-dir file `tool-policy.json` under `Layout` (host/agent instance). Optional identity-repo merge from `agent/tool-policy.json` (versioned defaults) read at startup and layered under exec-dir overrides.
- **Carry `needsApproval` onto `ToolDef`** so the enforcement chokepoint is in `runToolLoop` (and codemode bridge) — one place, all tools.

## Architecture

```
tool invoke (runToolLoop wrapper OR codemode bridge)
        │
        ├─ hard shell-policy (existing, inside handlers) …
        │
        └─ if tool.needsApproval?(input) === true
                │
                ├─ policy.match(tool, input) === allow → proceed
                ├─ policy.match === deny → structured error (no event storm)
                └─ no match → structured PendingApproval error
                              + emit runtime event with proposed rule
```

```
tool-policy.json (exec dir)          agent/tool-policy.json (identity, optional)
───────────────────────────          ──────────────────────────────────────────
rules: PolicyRule[]                  rules: PolicyRule[]   // base layer
                                     exec-dir wins on conflict (same id/tool+pattern)
```

### Data model

```ts
// packages/runtime/src/tools/tool-policy.ts
export type PolicyEffect = 'allow' | 'deny';

export type PolicyRule = {
  id: string;              // ulid/uuid
  tool: string;            // tool name, or '*' 
  /**
   * Glob-ish matcher over a canonical "approval key" string derived from input.
   * For run_shell: command prefix / arity-style key (see below).
   * For fetch: URL origin + method.
   * For others: JSON.stringify of stable fields or '*'.
   */
  pattern: string;
  effect: PolicyEffect;
  scope: 'agent';          // v1: agent-wide only (exec-dir). Future: run | workstream
  createdAt: string;
  note?: string;
};

export type ToolPolicyFile = {
  version: 1;
  rules: PolicyRule[];
};
```

### Approval key derivation

| Tool | Key |
|---|---|
| `run_shell` | Normalized command string with a **prefix arity** heuristic (borrow spirit of OpenCode/Codex prefix rules): e.g. `npm install`, `git push`, `docker compose up` — not the full argv with paths/secrets when avoidable. Document the normalizer; keep it pure and unit-tested. |
| `fetch` / URL tools | `${method} ${origin}${pathname}` without query string by default |
| Custom tools | `'*'` if `needsApproval: true`, or a string returned from optional `approvalKey?(input)` later — **v1: `'*'` for boolean true**, function form only decides whether approval is needed |

v1 does not add `approvalKey` to the public `defineTool` API unless needed; boolean/function `needsApproval` is enough.

### Built-in `needsApproval` markings (v1)

Apply via wrapper in tool factories (not only custom tools):

| Tool | When |
|---|---|
| `run_shell` | Command matches a dangerous-pattern list (mutating git beyond status/diff/add/commit on feature branch heuristics, `rm -rf`, `curl|wget` posting, `ssh`, force push, production deploy scripts). Exact list lives in `tool-policy.ts` / `shell-approval.ts` and is unit-tested. Read-only shell stays ungated. |
| `fetch` | Non-GET, or GET to non-allowlisted hosts if a host allowlist exists; otherwise GET to public http(s) stays ungated (URL guard for private IPs remains hard deny). |
| Custom tools | Honor `needsApproval` from `defineTool`. |

Reviewer write blocks remain hard denies in shell-policy (not approval).

### Structured tool error

```ts
type ApprovalDeniedResult = {
  ok: false;
  kind: 'approval_required' | 'approval_denied';
  tool: string;
  approvalKey: string;
  message: string;
  /** Rule the UI/API can POST to allow this class of action */
  proposedRule: Omit<PolicyRule, 'id' | 'createdAt'>;
};
```

Returned as the tool’s string result (JSON), same as other structured tool errors — model sees it and can replan (ask communicator, skip the action, etc.). Does not throw out of `runToolLoop`.

### Runtime event

```ts
{
  kind: 'approval';
  tool: string;
  approvalKey: string;
  proposedRule: …;
  runId?: string;
  workstreamId?: string;
  at: string;
}
```

Add to `RuntimeEvent` union in `context.ts`. CLI `dev` logs it; UI may show a toast/list in a follow-up (UI not required to ship runtime v1).

### API

| Method | Path | Behavior |
|---|---|---|
| GET | `/policy/rules` | List effective rules (identity base + exec overrides) |
| POST | `/policy/rules` | Add allow/deny rule → write exec-dir file |
| DELETE | `/policy/rules/:id` | Remove exec-dir rule (cannot delete identity-base via API; override with deny) |

Auth: existing bearer auth.

## Components

| Unit | Path | Responsibility |
|---|---|---|
| Policy core | `tools/tool-policy.ts` | Load/save, match, key derivation, dangerous shell patterns |
| Enforcement | `llm/loop.ts` + `codemode/bridge.ts` | Check before handler; shared `enforceApproval(tool, input, policy)` |
| ToolDef | `llm/types.ts`, `api/define-tool.ts` | Plumb `needsApproval` onto `ToolDef` |
| Shell / fetch factories | `tools/shell.ts`, `tools/fetch.ts` | Set `needsApproval` functions |
| Layout | `storage/layout.ts` | `toolPolicyFile()` → `<execDir>/tool-policy.json` |
| Identity | `storage/identity-layout.ts` | Optional `agent/tool-policy.json` path |
| Server | `server/app.ts` | Policy CRUD routes |
| Events | `context.ts` | `approval` event kind |

## Interaction with hard shell-policy

Order inside `run_shell` handler:

1. Hard `shell-policy` checks (unchanged) → string error if denied.
2. Outer loop approval enforcement already ran for `needsApproval` — keep both; hard deny wins conceptually because handler never runs… **Prefer: approval check in loop before handler; hard policy stays inside handler as defense in depth.**

## Testing

- `needsApproval: true` tool with empty policy → structured `approval_required`, event emitted, handler not called.
- Matching allow rule → handler called.
- Matching deny rule → `approval_denied`, no event spam (or single event max).
- Dangerous `run_shell` patterns unit table.
- Identity base + exec override precedence.
- Codemode inner `tools.run_shell` hits the same enforcement (bridge calls `enforceApproval`).
- `toToolDef` preserves `needsApproval`.

## Docs

- `docs/guides/writing-custom-tools.md`: document `needsApproval`.
- `docs/reference/config.md` or a short policy section: file locations + API.
- Note: autonomous agents should ship useful `agent/tool-policy.json` allow rules for their normal workflow.

## Non-goals

- Interactive blocking modal inside the run (no mid-handler `await human`)
- Guardian secondary LLM
- OS sandbox escalation retries
- Per-run / per-workstream scopes (v1 agent-wide only)
- Auto-amending policy from the model without human/API (model cannot write policy file)
- Replacing hard shell-policy denies with soft approvals

## Constraints

- Policy files must not store full secrets (approval keys should avoid tokens/passwords — redact obvious `=` env assignments in shell keys).
- Enforcement must apply to codemode inner calls (authority is siblings, but policy still binds).
- Missing/corrupt `tool-policy.json` → treat as empty rules + log warning (fail closed on gated actions).
