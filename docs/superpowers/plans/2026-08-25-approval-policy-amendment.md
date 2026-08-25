# Approval → Durable Policy Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `needsApproval` before tool handlers run, deny-by-default when no allow rule matches, emit an `approval` runtime event with a proposed rule, and persist human/API allow/deny amendments in `tool-policy.json`.

**Architecture:** Pure policy module (load/match/key derivation) + single `enforceApproval()` chokepoint used by `runToolLoop` wrappers and the codemode bridge. Hard `shell-policy` denials stay inside handlers. Exec-dir rules override optional identity `agent/tool-policy.json`.

**Tech Stack:** TypeScript ESM, existing Hono server auth, Node `node:test`.

**Spec:** [docs/superpowers/specs/2026-08-25-approval-policy-amendment-design.md](../specs/2026-08-25-approval-policy-amendment-design.md)

## Global Constraints

- No mid-handler `await human` — structured tool error only.
- No Guardian LLM.
- Hard shell-policy unchanged and still runs inside handlers.
- v1 scope is agent-wide rules only (`scope: 'agent'`).
- Model cannot write the policy file; only API/human.
- Corrupt/missing policy file → empty rules + warning (fail closed on gated actions).
- Approval keys must avoid obvious secrets (redact `KEY=...` / token-like tokens in shell keys).

## File map

| File | Responsibility |
|---|---|
| `packages/runtime/src/tools/tool-policy.ts` | Types, load/save, match, keys, dangerous shell detector |
| `packages/runtime/src/tools/approval.ts` | `enforceApproval()` |
| `packages/runtime/src/llm/types.ts` | `needsApproval?` on `ToolDef` |
| `packages/runtime/src/api/define-tool.ts` | Plumb `needsApproval` |
| `packages/runtime/src/llm/loop.ts` | Call enforce before handler |
| `packages/runtime/src/codemode/bridge.ts` | Same enforce for inner calls |
| `packages/runtime/src/tools/shell.ts`, `fetch.ts` | Set `needsApproval` fns |
| `packages/runtime/src/storage/layout.ts` | `toolPolicyFile()` |
| `packages/runtime/src/storage/identity-layout.ts` | `agentToolPolicyFile()` |
| `packages/runtime/src/context.ts` | `approval` RuntimeEvent |
| `packages/runtime/src/server/app.ts` | CRUD `/policy/rules` |
| Docs | custom tools guide + reference |

---

### Task 1: Policy file model, keys, match

**Files:**
- Create: `packages/runtime/src/tools/tool-policy.ts`
- Modify: `packages/runtime/src/storage/layout.ts`, `identity-layout.ts`
- Test: `packages/runtime/src/tools/tool-policy.test.ts`

**Interfaces:**
```ts
export type PolicyEffect = 'allow' | 'deny';
export type PolicyRule = {
  id: string;
  tool: string;
  pattern: string;
  effect: PolicyEffect;
  scope: 'agent';
  createdAt: string;
  note?: string;
};
export type ToolPolicyFile = { version: 1; rules: PolicyRule[] };

export function shellApprovalKey(command: string): string;
export function fetchApprovalKey(method: string, url: string): string;
export function isDangerousShellCommand(command: string): boolean;

export function loadEffectivePolicy(opts: {
  execPath: string;
  identityPath?: string;
}): ToolPolicyFile;

export function matchRule(
  policy: ToolPolicyFile,
  tool: string,
  approvalKey: string,
): PolicyRule | undefined;

export function saveExecPolicy(execPath: string, file: ToolPolicyFile): void;
```

- [ ] **Step 1: Failing tests**
  - `shellApprovalKey('npm install lodash')` → `'npm install'` (arity heuristic table for npm/git/docker compose/etc.)
  - Redacts `TOKEN=supersecret` from keys
  - `isDangerousShellCommand('rm -rf /')` true; `'git status'` false
  - Identity allow + exec deny for same tool+pattern → deny wins
  - `matchRule` glob: pattern `npm *` matches `npm install`
  - Missing file → `{ version: 1, rules: [] }`

- [ ] **Step 2: Implement + PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): add tool policy file model and approval keys

EOF
)"
```

---

### Task 2: `needsApproval` on `ToolDef` + `enforceApproval` + loop/bridge

**Files:**
- Modify: `llm/types.ts`, `api/define-tool.ts`, `api/types.ts` (ensure definition field retained)
- Create: `packages/runtime/src/tools/approval.ts`
- Modify: `llm/loop.ts`, `codemode/bridge.ts`
- Modify: `tools/shell.ts`, `tools/fetch.ts`
- Modify: `context.ts` — approval event
- Test: `approval.test.ts`, extend define-tool / loop tests if present

**Interfaces:**
```ts
// ToolDef
needsApproval?: boolean | ((input: Record<string, unknown>) => boolean);

export type ApprovalDeniedPayload = {
  ok: false;
  kind: 'approval_required' | 'approval_denied';
  tool: string;
  approvalKey: string;
  message: string;
  proposedRule: Omit<PolicyRule, 'id' | 'createdAt'>;
};

export function enforceApproval(args: {
  tool: ToolDef;
  input: Record<string, unknown>;
  policy: ToolPolicyFile;
  emit?: (event: RuntimeEvent) => void;
  runId?: string;
  workstreamId?: string;
}): { allow: true } | { allow: false; result: string /* JSON ApprovalDeniedPayload */ };
```

Approval key selection inside enforce:
- `run_shell` → `shellApprovalKey(String(input.command ?? ''))`
- `fetch` → `fetchApprovalKey(method, url)`
- else → `'*'`

- [ ] **Step 1: Failing tests**
  - `needsApproval: true`, empty policy → handler not called; JSON `approval_required`; emit called once
  - Allow rule → handler called
  - Deny rule → `approval_denied`, no emit (or assert emit not required)
  - `defineTool({ needsApproval: true })` → `toToolDef().needsApproval === true`
  - Codemode bridge path: mock tool with needsApproval blocked before handler

- [ ] **Step 2: Implement loop wrapper** — when building AI SDK tools, wrap handler:
  ```ts
  const decision = enforceApproval({ tool: def, input, policy, emit, runId, workstreamId });
  if (!decision.allow) return decision.result;
  return def.handler(input);
  ```
  Load policy once per `runToolLoop` (or pass in via options from `executeCall`).

- [ ] **Step 3: Shell/fetch `needsApproval`**
  - shell: `(input) => isDangerousShellCommand(String(input.command ?? ''))`
  - fetch: gate non-GET (and optionally non-allowlisted hosts if list exists; else non-GET only per spec)

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): enforce needsApproval with durable policy checks

EOF
)"
```

---

### Task 3: Policy HTTP API

**Files:**
- Modify: `packages/runtime/src/server/app.ts` (and auth as existing routes)
- Test: server test if pattern exists, or thin unit test of handlers extracted to `server/policy-routes.ts`

**Routes:**
- `GET /policy/rules` → effective rules
- `POST /policy/rules` body `{ tool, pattern, effect, note? }` → assign id + createdAt, append exec file
- `DELETE /policy/rules/:id` → remove from exec file only

- [ ] **Step 1: Failing tests** for POST then GET includes rule; DELETE removes; cannot delete identity-only id (404 or 400).

- [ ] **Step 2: Implement + PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(runtime): add tool policy CRUD HTTP API

EOF
)"
```

---

### Task 4: Docs

- Modify: `docs/guides/writing-custom-tools.md`, `docs/reference/config.md` (or new short policy section)

- [ ] Document `needsApproval`, file paths, API, deny-by-default behavior.
- [ ] Commit

```bash
git commit -m "$(cat <<'EOF'
docs: document tool approval policy

EOF
)"
```

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Policy file + identity layering | 1 |
| Key derivation + dangerous shell | 1 |
| `needsApproval` on ToolDef | 2 |
| enforce in loop + codemode | 2 |
| Structured error + event | 2 |
| Built-in shell/fetch gating | 2 |
| HTTP CRUD | 3 |
| Docs | 4 |
