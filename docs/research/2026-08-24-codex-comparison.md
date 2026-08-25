# Artificer vs. OpenAI Codex — Comparison (2026-08-24)

> Research conducted 2026-08-24 via parallel deep-dives into `/Users/danielbanks/dev/codex` (local checkout of the open-source Codex agent harness — primarily the Rust `codex-rs/` workspace) and Artificer's `packages/runtime/src/`, plus cross-checks against existing Artificer research ([opencode](./2026-08-14-opencode-comparison.md), [Letta](./2026-08-12-letta-comparison-independent.md), [codemode design](../superpowers/specs/2026-08-17-codemode-batched-tool-orchestration-design.md)). File paths below are absolute under those trees unless noted.

---

## tl;dr

**Codex is a production IDE coding-agent harness** (Rust `codex-core`) driven by a Submission→Event protocol, with a standard sample→tools→sample loop wrapped in unusually deep systems engineering: OS sandboxes + network MITM proxy, execpolicy that turns approvals into durable rules, Guardian (secondary LLM auto-approver), interruptible turns, typed context fragments with WorldState diffs, and a first-class **Code Mode** (V8 JS that orchestrates nested tools with `yield`/`wait` cells).

**Artificer is an autonomous GitHub-identity colleague** with a deterministic SWE FSM, portable identity repo, memory, quota/failover, pluggable worker executors, and a shipped QuickJS **codemode** `execute` tool. It is not trying to be an interactive TUI/IDE agent.

They overlap on one algorithmic idea Artificer already landed (codemode). Codex’s remaining value is mostly **production harness mechanics** Artificer lacks — especially around long-running code orchestration, approval→policy learning, and cache-friendly context — not a competing orchestration philosophy.

| Dimension | Codex | Artificer | Winner for Artificer’s goals |
|---|---|---|---|
| Product shape | Interactive IDE/TUI agent | Async autonomous colleague | Different products |
| Agent loop | Sample → tools → sample + stop hooks | Role calls + deterministic FSM | Artificer (for SWE reliability) |
| Codemode | V8 + `exec`/`wait` cells + session KV + CodeModeOnly | QuickJS + opt-in `execute` beside tools | Codex (richer); Artificer has the core idea |
| Sandbox | Seatbelt / bwrap / Landlock + network proxy | Policy heuristics + guest WASM | Codex |
| Approvals | Multi-gate + Guardian + amend-on-approve | Review FSM only; `needsApproval` unwired | Codex (if Artificer wants HITL) |
| Memory | Async rollout extract → consolidate | Identity git memories + librarian distill | Artificer (portable identity) |
| Cost governance | Observational | Tiers + quotas + failover | Artificer |
| Context injection | Typed fragments + WorldState diffs | Role prompts + digests + spill | Codex (cache discipline) |

---

## What Codex actually is

### Harness shape

Clients (TUI, app-server JSON-RPC, TS/Python SDKs) speak:

```
Submission { id, Op }  →  CodexThread / Session  →  Event { id, EventMsg }
```

Core loop lives in `codex-rs/core/src/session/turn.rs` (`run_turn`):

1. Pre-sampling auto-compact near token limit
2. Capture **`StepContext`** — frozen tool plan, MCP bindings, approval policy for *this sampling request*
3. Stream model response; enqueue tool calls into `ToolCallRuntime` (parallel via RwLock gate)
4. If tools ran → continue; else run **Stop hooks** (may inject continuation and keep going)
5. Mid-turn compact if still needing follow-up past the token budget

`StepContext` (`core/src/session/step_context.rs`) is a subtle but important invariant: tools advertised to the model and used for nested/deferred calls stay consistent for that sampling step even if config changes mid-turn.

### Distinctive subsystems (not the generic loop)

| Subsystem | Path | Idea |
|---|---|---|
| **Code Mode** | `codex-rs/code-mode-*`, `core/src/tools/code_mode/` | Model mostly sees `exec` + `wait`; nested tools live on `tools.*` inside V8; early yield + `cell_id` resume; session `store`/`load` |
| **ToolOrchestrator** | `core/src/tools/orchestrator.rs` | approval → sandbox → attempt → escalate sandbox retry without re-prompt |
| **Guardian** | `core/src/guardian/` | Secondary LLM auto-reviews `OnRequest` approvals; fail-closed; denial budgets |
| **WorldState** | `core/src/context/world_state/` | Sectional state; only emit **diffs** into history when a section changes (prompt-cache friendly) |
| **ContextualUserFragment** | `context-fragments` + `core/src/context/` | Every injection is typed, sized, role-tagged — not string soup |
| **Execpolicy amendments** | `codex-execpolicy` + `ReviewDecision` | User approval can permanently allow matching command prefixes |
| **Network proxy** | `codex-network-proxy` | Domain allow/deny + limited MITM as first-class sandbox layer |
| **apply_patch** | `codex-apply-patch` | Structured patch language + apply engine (safer than free-form shell edits) |
| **Unified Exec** | `core/src/unified_exec/` | Long-lived PTY sessions (`exec_command` / `write_stdin`) with yield-time budgeting |
| **Memories pipeline** | `codex-rs/memories/{read,write}` | Phase1 per-rollout extract + Phase2 global consolidation (async on session start) |
| **tool_search / deferred tools** | `tools/handlers`, `tool_namespaces_info.rs` | Hide large MCP/plugin surfaces until searched |
| **Extension API** | `codex-rs/ext/extension-api/` | Contributor traits for tools/context/lifecycle without forever growing `core` |
| **Hooks** | `codex-hooks` + `hook_runtime.rs` | Claude-Code-like PreToolUse / Stop / PreCompact; Stop can block and continue the turn |

### Code Mode vs Artificer’s `execute` (important delta)

Artificer already shipped the OpenCode-inspired core: opt-in `execute({ code })` → sync QuickJS → `tools.<name>()` with concurrency 8, sibling-tool authority only (`packages/runtime/src/codemode/`).

Codex’s Code Mode is the same genus, further evolved:

| Feature | Artificer `execute` | Codex Code Mode |
|---|---|---|
| Guest engine | QuickJS WASM (sync) | V8 isolate (can be out-of-process host via gRPC/WS) |
| Tool surface to model | Sibling tools **still listed** + `execute` | Can be **CodeModeOnly** — model mostly sees `exec`/`wait` |
| Long-running scripts | Timeout kills the program | `yield_control` / `yield_time_ms` → returns `cell_id`; `wait` resumes |
| Cross-call state | None (fresh isolate per call) | Session KV `store`/`load` |
| Streaming to model mid-script | No | `notify(...)` injects intermediate tool outputs |
| Nested tool signatures | Inlined in tool description | TS-rendered from JSON Schema; deferred tools via `ALL_TOOLS` + search |
| Approvals for nested calls | Same as outer tools (today: none) | Full ToolOrchestrator / Guardian / sandbox path |

**Borrow signal:** Artificer does not need to rewrite codemode. The high-value Codex upgrades are **yield/wait cells**, optional **CodeModeOnly** exposure, and session KV — especially for worker runs that currently die on long `Promise.all` batches when the outer timeout fires.

### What is *not* novel (don’t borrow for novelty)

- Classic sample → tools → sample loop
- MCP client wiring (table stakes; Artificer still needs inbound MCP, but Codex isn’t a uniquely good template beyond “do it”)
- Skills-as-markdown / AGENTS.md (Claude Code / Cursor adjacent)
- Personality prompt templates
- Generic compaction-via-summarization (their *discipline* around mid-turn injection and WorldState diffs is the interesting part, not “summarize older messages”)
- Feature-flag spaghetti and a monolithic core (their own `AGENTS.md` warns against growing `codex-core` further)

---

## Framing: product mismatch first

Borrowing from Codex without this filter will produce wrong priorities:

1. **Codex optimizes for interactive, interruptible coding sessions** (steer / recover / suspend, approval UX, token streaming to a TUI).
2. **Artificer optimizes for unattended workstreams** with review gates, durable identity, and cost caps.

So:

- **Do borrow** ideas that improve unattended reliability, context economics, and codemode depth.
- **Borrow carefully** interactive HITL/sandbox stacks — only where Artificer’s threat model actually needs them (self-hosted agents with shell on user machines / shared runners).
- **Don’t borrow** IDE session semantics, personality overlays, or Codex’s Rust packaging shape.

---

## Borrow ranking for Artificer

### Tier 1 — High value, fits Artificer’s product

#### 1. Codemode: yield / wait cells + session KV

**Why:** Worker `execute` programs that do multi-file exploration can hit timeout and lose work. Codex’s `cell_id` + `wait` pattern turns “one long script” into a resumable cell the model can poll — still one orchestration language, but compatible with turn budgets.

**Where in Codex:** `code-mode-protocol/src/description.rs` (`yield_control`, `store`/`load`, `notify`); `core/src/tools/code_mode/{execute,wait}_handler.rs`.

**Artificer fit:** Extend `packages/runtime/src/codemode/` without changing the opt-in-beside-tools decision. Optional later: a `CodeModeOnly`-style mode for worker when tool-schema pressure is high.

#### 2. Frozen per-call tool plan (`StepContext` spirit)

**Why:** Nested codemode calls and mid-run config changes (quota failover, model switch) shouldn’t change which tools a program is allowed to see mid-flight.

**Where:** `core/src/session/step_context.rs`.

**Artificer fit:** When building `execute`’s sibling map (and any future custom-tool registry), snapshot the tool set at call start and pass that Arc into the guest — don’t re-read live registries per inner call.

#### 3. Approval → durable policy amendment (execpolicy learning)

**Why:** Artificer already has shell policy heuristics and a stub `needsApproval` field that is never enforced. Codex’s best HITL idea isn’t the modal UX — it’s that **approvals become rules** (`ApprovedExecpolicyAmendment`, `ApprovedForSession`, network/MCP amendments).

**Where:** `ReviewDecision` in `codex-rs/protocol/src/protocol.rs`; `codex-execpolicy`.

**Artificer fit:** Wire `needsApproval` for dangerous shell/git/network tools; on allow, optionally persist a prefix/rule into the identity repo or exec-dir policy file. Matches autonomous operation better than per-call human prompts for every `npm install`.

#### 4. WorldState-style sectional context diffs (lighter form)

**Why:** Artificer rebuilds large role/system/context blobs often (git status, findings, prior-run digests). Codex’s WorldState only injects a fragment when a section’s snapshot changes — better for prompt caching and noise reduction.

**Where:** `core/src/context/world_state/`.

**Artificer fit:** Don’t port the whole trait machinery. Identify 3–5 volatile sections (git status, findings blackboard, quota state, memory signpost, plan digest) and only re-append when hash(content) changes across calls in the same workstream run.

#### 5. Deferred tool discovery (`tool_search`)

**Why:** MCP / custom tools / skills will explode schema tokens once Artificer finishes wiring them. Codex keeps many tools deferred and searchable.

**Where:** `tools/tool_namespaces_info.rs`, tool_search handlers.

**Artificer fit:** When wiring `defineConnection` / custom tools / skills, default to a small always-on set + `search_tools` / skill loader rather than dumping every schema into every worker call. Complements codemode’s sibling freeze.

---

### Tier 2 — Valuable if Artificer’s threat model grows

#### 6. ToolOrchestrator: approval → sandbox → escalate-retry

Unified pipeline for “try restricted, on denial escalate once without re-asking.” Useful if Artificer ever adds real OS sandboxing for worker shell (Docker/bwrap) or runs untrusted custom tools from identity repos more aggressively.

#### 7. Guardian-style auto-reviewer (narrowed)

Secondary LLM that auto-allows/denies risky actions with a hard policy doc (`guardian/policy.md` — exfiltration, destructive git, credential probing). For Artificer this maps better to **autonomous gatekeeping** than to Codex’s interactive approval UX: e.g. librarian distill, outbound `fetch`, or shell mutations that fail `needsApproval` heuristics could be Guardian-reviewed instead of waking a human.

Caveat: cost + latency; Artificer’s quota system would need to account for guardian spend. Fail-closed + consecutive-denial caps are the parts worth copying, not the full product surface.

#### 8. Structured `apply_patch` (or keep improving edit cascade)

Codex invests heavily in a patch language + apply engine. Artificer’s `edit.ts` already has a sophisticated replacer cascade (ported from OpenCode/Cline). **Don’t replace that.** Optionally add a multi-hunk patch tool for large coordinated edits if worker evals show single-file search/replace thrashing.

#### 9. Stop hooks / post-turn continuation

Codex Stop hooks can block turn completion and inject a continuation prompt (verification, lint, “did you update the plan?”). Artificer’s FSM already encodes plan→implement→review. The borrowable fragment is **hookable post-role-call checks** (e.g. after worker run, before FSM advances) as identity-repo or runtime plugins — not a second orchestration brain.

#### 10. Parallel tool gate (exclusive vs parallel-safe)

Codex’s RwLock: parallel-safe tools take read; exclusive take write. Artificer’s `runToolLoop` is mostly serial per model step; codemode already has concurrency 8. Worth adopting when native multi-tool-calls (AI SDK parallel tools) become common for planner/worker outside codemode.

---

### Tier 3 — Interesting, lower priority / wrong shape

| Idea | Why deprioritize |
|---|---|
| Full OS sandbox stack (Seatbelt/bwrap/Landlock + MITM proxy) | Huge surface; Artificer is self-hosted trusted identity code today; OpenCode research already said sandbox isn’t Artificer’s near-term bet |
| Unified Exec long-lived PTYs | Interactive coding UX; Artificer workers are batch runs |
| Submission/Event IDE protocol + steer/suspend | Different product; Artificer has workstream notes / SSE activity |
| Extension contributor API as Rust traits | Artificer’s `define*` + identity repo is the right extension story; finish wiring tools/skills first |
| Memories Phase1/2 from rollouts | Artificer’s librarian distill + identity memories already cover the product need; Codex’s DB-backed pipeline is for chat rollouts |
| Personality templates / collaboration modes | Product chrome |
| Codex-as-MCP-server | Nice for ecosystem; not a harness borrow |

---

## Gaps Codex highlights in Artificer (without copying Codex)

These are Artificer issues Codex makes *visible*, where the fix may not be “port Codex”:

1. **`needsApproval` is declared and never enforced** — wire it or delete it.
2. **Custom tools / skills discovered but not injected into `executeCall`** — finish the extension path before adding more extension concepts.
3. **No inbound MCP tool proxy** — Codex/OpenCode/Claude treat this as table stakes; Artificer’s `defineConnection` is still a stub.
4. **Codemode has no mid-script yield** — biggest functional gap vs Codex Code Mode given Artificer already chose this architecture.
5. **Context rebuilt wholesale each call** — WorldState diffs are the pattern; structured OpenCode compaction template remains a prior Tier-1 from the OpenCode research.

---

## What Artificer should *not* change because of Codex

- **Deterministic workstream FSM** — Codex has no equivalent; don’t LLM-orchestrate routing again.
- **Identity-as-git-repo** — stronger portability story than Codex rollouts + memories DB.
- **Quota / tier / failover** — Codex is behind here (same finding as vs OpenCode).
- **Pluggable worker executors** — Codex *is* the agent; Artificer can already shell out to Claude Code / Cursor / OpenCode.
- **Opt-in codemode beside tools** — Codex’s CodeModeOnly is an advanced mode; Artificer’s locked design (tools remain visible) is still correct for v1; add Only as an optional later knob.

---

## Suggested next steps (if acting on this research)

Design specs — **Approved for planning** (2026-08-25):

1. [Codemode v2 — yield/wait + session KV](../superpowers/specs/2026-08-25-codemode-yield-wait-design.md) → [plan](../superpowers/plans/2026-08-25-codemode-yield-wait.md)
2. [Frozen per-call tool plan](../superpowers/specs/2026-08-25-frozen-tool-plan-design.md) → [plan](../superpowers/plans/2026-08-25-frozen-tool-plan.md)
3. [Approval → durable policy amendment](../superpowers/specs/2026-08-25-approval-policy-amendment-design.md) → [plan](../superpowers/plans/2026-08-25-approval-policy-amendment.md)
4. [Context section diffs (WorldState-lite)](../superpowers/specs/2026-08-25-context-section-diffs-design.md) → [plan](../superpowers/plans/2026-08-25-context-section-diffs.md)
5. [Deferred tool discovery](../superpowers/specs/2026-08-25-deferred-tool-discovery-design.md) → [plan](../superpowers/plans/2026-08-25-deferred-tool-discovery.md)

Suggested implementation order: **frozen plan → codemode v2**; **context diffs** in parallel; **approvals** next; **deferred discovery** after frozen plan.

Do **not** start a Seatbelt/bwrap port or Guardian product surface until Tier 1 pays off and there’s a concrete threat model (untrusted tools, multi-tenant host, etc.).

---

## Key absolute paths

```
# Codex
/Users/danielbanks/dev/codex/codex-rs/core/src/session/turn.rs
/Users/danielbanks/dev/codex/codex-rs/core/src/session/step_context.rs
/Users/danielbanks/dev/codex/codex-rs/core/src/tools/orchestrator.rs
/Users/danielbanks/dev/codex/codex-rs/core/src/tools/code_mode/
/Users/danielbanks/dev/codex/codex-rs/core/src/context/world_state/
/Users/danielbanks/dev/codex/codex-rs/core/src/guardian/
/Users/danielbanks/dev/codex/codex-rs/code-mode-protocol/src/description.rs
/Users/danielbanks/dev/codex/codex-rs/protocol/src/protocol.rs
/Users/danielbanks/dev/codex/codex-rs/memories/README.md

# Artificer
/Users/danielbanks/dev/artificer/packages/runtime/src/codemode/
/Users/danielbanks/dev/artificer/packages/runtime/src/engine/workstream-machine.ts
/Users/danielbanks/dev/artificer/packages/runtime/src/engine/call.ts
/Users/danielbanks/dev/artificer/packages/runtime/src/tools/registry.ts
/Users/danielbanks/dev/artificer/docs/superpowers/specs/2026-08-17-codemode-batched-tool-orchestration-design.md
```
