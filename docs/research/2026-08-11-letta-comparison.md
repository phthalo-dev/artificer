# Artificer vs. Letta: Competitive Analysis & Borrowing Guide

> Research conducted 2026-08-11. Sources: [Letta docs](https://docs.letta.com/), [Agent SDK docs](https://docs.letta.com/agent-sdk), local checkouts of [`letta`](../letta) (legacy server) and [`letta-code`](../letta-code) (current harness), and the Artificer monorepo.

## Executive Summary

**Letta** (formerly MemGPT) and **Artificer** both pursue the same broad thesis: *agents should be persistent entities that learn over time, not disposable chat sessions.* They converge on git-tracked memory, skills, multi-channel messaging, and self-modification — but diverge sharply on **what problem they optimize for**.

| Dimension | Letta | Artificer |
|---|---|---|
| **Primary use case** | General-purpose stateful agents (coding assistant, personal chief-of-staff, embedded app agents) | Autonomous AI developer with its own GitHub identity |
| **Core metaphor** | OS-style memory hierarchy (RAM / swap / disk) | Software engineering workflow (plan → implement → review → PR) |
| **State location** | Letta Cloud (default) or self-hosted App Server + PostgreSQL | File-backed identity repo + ephemeral exec dir |
| **Orchestration** | Model-driven tool loop with optional tool rules | Deterministic workstream state machine + role-scoped LLM calls |
| **Coding focus** | Harness (letta-code) with rich local tools | First-class SWE loop, bench harness, external executor swap |

**Bottom line:** Letta is the deeper memory-and-continuity platform; Artificer is the more opinionated autonomous coding colleague. The overlap is real and growing (skills, channels, git memory, self-modification), but Artificer's differentiation — portable identity repo, deterministic SWE orchestration, GitHub persona, cost engineering, and integrated benchmarking — is not something Letta is trying to be. Conversely, Letta's archival memory, sleeptime agents, conversation search, and harness self-modification (mods) are areas Artificer could learn from without abandoning its core identity.

---

## What Letta Is Today

Letta has evolved through three layers. Understanding this matters because the **`letta` Python repo is deprecated** (maintenance mode for the V1 API server); active development lives in **letta-code** and the **Letta Agent SDK**.

```
┌─────────────────────────────────────────────────────────────────┐
│  Surfaces: CLI (Ink TUI) · Desktop app · chat.letta.com         │
│            Telegram · Slack · Discord · custom channels            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  letta-code (open-source harness)                                 │
│  Tool execution · skills · mods · hooks · permissions · crons     │
│  WebSocket listener for remote environments                       │
└────────────────────────────┬────────────────────────────────────┘
                             │ @letta-ai/letta-client / Agent SDK
┌────────────────────────────▼────────────────────────────────────┐
│  Letta Cloud (default) or App Server (self-hosted)              │
│  Agent state · conversations · MemFS · blocks · archives      │
│  PostgreSQL + Redis + pgvector                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Research lineage:** Letta grew out of MemGPT (UC Berkeley). The product thesis is "machines that learn" — agents rewrite their own context, accumulate experience across sessions, and improve behavior through token-space learning rather than weight updates.

**Key products:**
- **letta-code** (`@letta-ai/letta-code`) — the coding agent harness (CLI `letta`, TUI, headless mode)
- **Letta Agent SDK** (`@letta-ai/letta-agent-sdk`) — programmatic interface for embedding stateful agents in applications
- **Letta Cloud** — managed backend (Constellation)
- **Legacy `letta` server** — FastAPI + PostgreSQL V1 API (deprecated; use App Server instead)

---

## What Artificer Is (for comparison)

Artificer is a **self-hostable platform for autonomous AI coding agents with portable git-based identity**. The agent is defined by an identity repo (config, instructions, tools, channels, skills, memories) and runs as a single Node.js process with no database.

```
┌─────────────────────────────────────────────────────────────────┐
│  Channels: Web UI · Slack · Discord · GitHub watcher · HTTP API │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  @artificer-ai/runtime (single process)                         │
│  Roles: communicator · planner · worker · reviewer · librarian  │
│  Deterministic workstream FSM · tools · quota/cost tracking     │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                                       │
┌────────▼──────────┐                 ┌──────────▼──────────┐
│  Identity repo    │                 │  Execution state    │
│  (git-tracked)    │                 │  (~/.artificer/)    │
│  config, tools,   │                 │  messages, runs,    │
│  skills, memories │                 │  workstreams, repos │
└───────────────────┘                 └─────────────────────┘
```

See also: [Eve comparison](./2026-06-22-eve-comparison.md) for broader market positioning.

---

## Overlap: Where the Projects Converge

### 1. Persistent, self-editable memory

Both systems treat memory as a first-class, agent-writable resource — not just RAG over static documents.

| Concept | Letta | Artificer |
|---|---|---|
| In-context memory | **Memory blocks** (`persona`, `human`, custom labels) compiled into system prompt | Standing instructions (`agent/instructions.md`) + role prompts; passive **signpost** hinting at memory count/tags |
| Long-term notes | **Archival memory** (passages in PostgreSQL + vector search) + **MemFS** git-backed filesystem | **Markdown files** in `identity/memories/` with index, graph, optional embeddings |
| Agent writes memory | `memory`, `core_memory_append`, `archival_memory_insert` tools | `add_memory` tool; workstream **chronicles** + librarian **distillation** into claims/entities |
| Git versioning | MemFS commits with agent authorship; shared memory repos attachable to multiple agents | Identity repo is git-tracked; optional `autoCommit` / `autoPush` on memory writes |
| Search | `conversation_search`, `archival_memory_search` (semantic) | `query_memories` (word + optional embedding hybrid) |

The philosophical alignment is strong: *agents should curate their own knowledge base over time.* Both reject "dump everything into context" as the memory strategy.

### 2. Skills (procedural memory)

| | Letta | Artificer |
|---|---|---|
| Location | `~/.letta`, `.agents/skills`, MemFS `skills/` | `agent/skills/` in identity repo |
| Loading | Bundled + user + agent-scoped; `skill` tool to invoke | `defineSkill()` API; scanned from identity repo |
| Purpose | Reusable workflows the agent (or user) authors | Same — on-demand knowledge modules |

Letta's skills ecosystem is more mature (bundled operational skills like `creating-mods`, `initializing-memory`, `self-configuration`). Artificer's skills are structurally similar but less central to the product narrative.

### 3. Multi-channel messaging

Both support reaching the same agent from multiple surfaces:

| Channel | Letta (letta-code) | Artificer |
|---|---|---|
| CLI / TUI | ✅ Ink React TUI | ✅ `artificer dev` + web UI |
| Web | ✅ chat.letta.com, desktop app | ✅ bundled React dashboard |
| Slack | ✅ | ✅ built-in adapter |
| Discord | ✅ | ✅ built-in adapter |
| Telegram | ✅ | ❌ (custom channel possible) |
| GitHub | ❌ (not first-class) | ✅ watcher for CI, reviews, @-mentions |

Both use a channel abstraction that normalizes inbound messages into the agent's message loop. Letta's channel notifications arrive as structured XML in the prompt; Artificer's channels mount as Hono routes feeding `engine.receiveMessage()`.

### 4. Extensibility APIs

| Pattern | Letta | Artificer |
|---|---|---|
| Custom tools | Python/TS in sandboxes (local, E2B, Modal) + MCP | `defineTool()` in `agent/tools/` |
| MCP | First-class `EXTERNAL_MCP` tool type, OAuth, server CRUD | `defineConnection()` (planned/expanding) |
| Hooks | Claude Code–compatible lifecycle hooks | Not yet (gap vs. Eve/Letta) |
| Runtime extension | **Mods** — tools, commands, events, UI panels, providers | `defineChannel()`, custom roles via `agent/roles/*.md` |
| Permissions | Claude Code–compatible allow/deny/ask rules | Tool-scoped by role; no general approval framework yet |

### 5. Model-agnostic execution

Both abstract over LLM providers and support swapping models. Artificer adds **role-tier presets** (`async-economy`, `quality-first`, etc.) mapping cheap/medium/expensive models to roles — a cost-engineering layer Letta does not emphasize.

### 6. Self-hosting path

Both offer a path from cloud → self-hosted:
- Letta: Cloud → App Server (replaces legacy `letta` image) → experimental local backend (pi-ai)
- Artificer: `artificer dev` → Docker → Fly.io → AWS hibernating EC2

---

## What Is Unique to Letta

### 1. Three-tier OS-inspired memory hierarchy

Letta's deepest differentiator is the explicit separation of:

- **Core memory** — always in-context blocks (persona, human, custom)
- **Recall memory** — full conversation history, searchable via `conversation_search`, compacted via summarizer
- **Archival memory** — long-term passages in shareable archives with pgvector embeddings

Artificer collapses "recall" into run records + workstream chronicles and "archival" into markdown memory files. Letta's model is richer for **long-running conversational agents** that need to search years of chat history semantically.

### 2. Sleeptime / background memory agents

When `enable_sleeptime=True`, Letta runs **background agents** after each user turn to consolidate memory without blocking conversational latency. Subagents include `reflection`, `memory`, `history-analyzer`, `recall`.

Artificer has a related but narrower pattern: fire-and-forget **librarian distill** after workstream completion. It does not have proactive "dreaming" (`letta dream`, `/sleeptime`) or cron-driven background cognition.

### 3. Separation of state and execution (multi-environment)

Letta Cloud holds agent state; `letta server` registers a machine as a **remote environment** that executes tool calls locally via WebSocket. The same agent can run tools on a laptop, a Mac Mini, and GitHub Actions.

Artificer co-locates state and execution in one runtime process. Multi-instance deployment is a future managed-service concern, not a first-class primitive.

### 4. MemFS as the memory editing interface

Letta projects memory blocks and external files to a **git-backed filesystem** (`$MEMORY_DIR`) so agents manage context with standard file/bash operations. Memory edits commit with agent authorship; pre-commit hooks enforce frontmatter.

Artificer's memories are also files, but the editing interface is tool-mediated (`add_memory`) rather than a projected filesystem with git workflow baked in. The identity repo *is* the git repo — Artificer doesn't need a separate MemFS projection layer because the whole identity is already on disk.

### 5. Mods (harness self-modification)

Letta mods let users (and agents) extend the harness itself: new tools, slash commands, event handlers, UI panels, even LLM providers — without forking letta-code.

Artificer's extension surface is the identity repo (`defineTool`, `defineChannel`, custom roles). The runtime itself is not designed to be modified by the agent at runtime.

### 6. Trajectory import (`@letta-ai/trajectory`)

Letta can **import session history from competing agents** (Claude Code, Codex, OpenHands, etc.) and normalize it into persistent memory. This is a powerful onboarding path: "become a better version of yourself by learning from your past sessions elsewhere."

Artificer has no equivalent. Its bench harness can *compare* against external agents but doesn't ingest their trajectories into identity.

### 7. Conversations as first-class resources

Letta agents can have **multiple concurrent conversation threads**, each with isolated context, per-conversation model overrides, and fork semantics.

Artificer has messages and workstreams but not a general multi-conversation threading model for casual chat.

### 8. Tool rules engine

Letta's `ToolRule` system (terminal, continue, max-count-per-step) constrains tool-call ordering declaratively. Artificer constrains tools by **role** (each role gets a scoped tool set) and by the **deterministic FSM** (only the right role runs at the right time).

### 9. Academic/research credibility

Letta/MemGPT has published research on memory management, continual learning, and sleep-time compute. This shapes product decisions (compaction thresholds, proactive 90% compaction for GPT-5 family, etc.) in ways that are battle-tested across many agent types.

---

## What Is Unique to Artificer

### 1. Git-versioned portable agent identity (whole-agent, not just memory)

Letta's MemFS versions *memory*; the agent's harness config, tools, and execution wiring live in letta-code or the cloud. Artificer's **entire agent definition** — config, instructions, tools, channels, skills, memories — is one git repo you clone, fork, and deploy anywhere.

This is Artificer's strongest moat. See [Eve comparison](./2026-06-22-eve-comparison.md).

### 2. Deterministic workstream state machine

`nextWorkstreamAction()` in `workstream-machine.ts` is a **pure function**: setup → plan → implement ↔ review → submit PR → done. Routing is code, not LLM judgment. Same facts → same next action, unit-testable.

Letta's agent loop is model-driven: the LLM decides which tools to call until a stop condition. Tool rules add constraints but don't replace orchestration with a state machine.

For **autonomous coding with predictable quality gates**, Artificer's approach is more reliable. For **open-ended conversation**, Letta's approach is more flexible.

### 3. Own GitHub persona

Artificer agents have their own GitHub account, commit identity, PR workflow, fork-on-403 handling, and CI/review response via the GitHub watcher. This "agent as colleague" model is central to the product.

Letta has no first-class GitHub integration. Coding is file/bash/git operations in a workspace, not "this agent opens PRs as itself."

### 4. Multi-model cost engineering

Role-tier presets, per-call complexity overrides, quota routing across provider accounts, spend caps, and bench reports with **USD per task** and per-role cost breakdown. This is first-class product infrastructure, not an afterthought.

Letta supports many providers but doesn't optimize for "cheap communicator, expensive planner" as a named preset system.

### 5. Integrated SWE benchmarking

`packages/runtime/bench/` runs SWE-bench Lite, DeepSWE, and greenfield suites with live SSE progress, external agent comparison (Claude Code, Cursor, opencode), and trajectory viewers. The planned `artificer eval` extends this to **customer-owned identity evals** in `agent/evals/`.

Letta has trajectory normalization for *importing* sessions but no equivalent built-in correctness benchmarking loop.

### 6. Pluggable worker executors

Artificer can swap the **worker** role to an external CLI agent (Claude Code, Cursor, Qwen Code) while keeping its own planner/reviewer/communicator orchestration. MCP bridges report status back.

Letta's harness *is* the coding agent. There's no "use Cursor for implementation, Letta for memory and review" split.

### 7. File-backed, no-database architecture

Single Node.js process, all state on disk. Simple to inspect, backup, and reason about. Letta's production path requires PostgreSQL, Redis, and (for archival search) pgvector — heavier ops for self-hosting.

### 8. Workstream-scoped isolation

Each coding task gets an isolated workspace clone, plan, tasks, reviews, and chronicle. Letta operates on a working directory but doesn't have the same structured SWE artifact model (`plan.md`, review verdicts, `MAX_REVIEW_CYCLES`).

---

## Ideas Worth Borrowing from Letta

### High value, fits Artificer's philosophy

| Idea | What Letta does | How Artificer could adopt it |
|---|---|---|
| **Conversation / recall search** | `conversation_search` over full message history | Add `query_runs` or `search_history` tool over run records and messages in exec dir; optionally index with the same embedding pipeline used for memories |
| **Sleeptime-style distillation** | Background agents consolidate memory after each turn | Extend librarian distill: optional post-message lightweight distill (not just post-workstream), configurable cadence |
| **Memory block / persona split** | Explicit `persona` vs `human` blocks in system prompt | Formalize `agent/instructions.md` into structured blocks (persona, user preferences, project context) with separate edit tools |
| **Trajectory import** | `@letta-ai/trajectory` normalizes Claude Code/Codex/etc. sessions | Build or adopt a trajectory importer that seeds `identity/memories/` from prior coding agent sessions — huge onboarding win |
| **Reference links in memory** | `[[path]]` synapses between memory blocks and skills | Add `related` graph edges (already exists) + prompt guidance for agents to maintain discovery paths |
| **Compaction sophistication** | Sliding window, self-compact, proactive 90% threshold per model family | Artificer has microcompact + tool spill + prior-run digests; borrow model-specific threshold tuning from Letta's summarizer |
| **Claude Code compatibility** | Permissions schema, hooks, tool naming (`Task` → `Agent`) | Low-friction migration path for users coming from Claude Code; aligns with external executor strategy |
| **Bundled operational skills** | Skills like `initializing-memory`, `creating-mods`, `self-configuration` | Ship starter skills in scaffolded projects: "how to write memories," "how to add a custom tool," "how to tune presets" |
| **Cron / schedules as first-class** | `letta cron`, heartbeats, `/sleeptime` | Artificer has `agent/schedules/` — study Letta's UX for recurring proactive work and dreaming |

### Medium value, evaluate carefully

| Idea | Consideration |
|---|---|
| **MemFS projection** | Artificer's identity repo already *is* a filesystem. Instead of projecting, expose memory files directly to worker/planner with git workflow docs — simpler than Letta's two-layer model |
| **Shared memory repos** | Attachable memory collections across agents — useful if Artificer ever supports multi-agent teams sharing a knowledge base |
| **Tool rules engine** | Could complement role-scoping for complex tool ordering (e.g., "must call `read_file` before `edit_file`") — but risks complexity vs. FSM |
| **Multi-conversation threads** | Useful for communicator role handling multiple chat threads; less critical for workstream-centric coding |
| **Mods system** | Powerful but conflicts with Artificer's "identity repo is the extension surface" philosophy — prefer `defineTool` over runtime self-modification |
| **Client tools / approval pauses** | Letta pauses for client-side tool execution and human approval — Artificer has this on the gap list from Eve comparison |

### Lower priority for Artificer's coding focus

| Idea | Why lower priority |
|---|---|
| **Archival memory with pgvector** | Artificer's markdown + optional local embeddings covers most coding-agent memory needs without PostgreSQL |
| **Voice agents** | Out of scope for Artificer |
| **Identities (multi-user personalization)** | Artificer agents are typically 1:1 with an owner; different problem |
| **Agent serialization (.af files)** | Git identity repo supersedes this for Artificer's model |

---

## What Artificer Should NOT Borrow from Letta

### 1. Cloud-first state architecture

Letta's default path stores agent state in Letta Cloud. Self-hosting requires App Server + PostgreSQL + Redis. Artificer's file-backed, single-process model is a **feature**, not a gap — especially for developers who want full ownership without running a database.

**Do not** add PostgreSQL as a requirement to match Letta's feature set.

### 2. Model-driven orchestration for coding workflows

Letta's free-form tool loop works for general agents. Artificer's deterministic FSM exists because model-driven plan/implement/review routing is unreliable and expensive. **Do not** replace `workstream-machine.ts` with LLM orchestration to be "more like Letta."

### 3. Harness self-modification (mods) as the primary extension model

Letta mods let agents rewrite the harness at runtime. Artificer's contract is: **extensions live in the identity repo, version-controlled in git.** Runtime self-modification blurs the line between "agent config" and "platform code" and makes auditing harder.

Prefer `defineTool`, `defineChannel`, `defineSkill`, custom roles — not mods.

### 4. "Agent as person" philosophy wholesale

Letta's system prompt (`letta.md`) emphasizes experiential learning, identity continuity across model changes, and rewriting one's own tokens. This is compelling for personal assistants but can **conflict** with Artificer's "agent as colleague" framing — a professional coding agent with a GitHub account, not an experiential entity.

Borrow memory *mechanisms*, not the full philosophical positioning.

### 5. Unrestricted default permissions

letta-code defaults to `unrestricted` permission mode. Artificer runs autonomous coding agents that push to git remotes — a stricter default (or role-scoped tool policies) is appropriate.

### 6. Legacy V1 API patterns

The `letta` Python repo is deprecated. Do not study or integrate against `@letta-ai/letta-client` V1 patterns — target letta-code + Agent SDK if integrating at all.

### 7. Competing on general-purpose agent platform

Letta is building a platform for *any* stateful agent embedded in applications (via Agent SDK). Artificer should not try to be a general agent platform — double down on **autonomous coding colleague with portable identity**.

---

## Side-by-Side Architecture Comparison

```
Letta (state/execution split)          Artificer (unified runtime)
─────────────────────────────          ─────────────────────────────

  Cloud / App Server                     Identity repo (git)
  ├─ blocks, archives,                   ├─ config, instructions
  │  conversations, MemFS                ├─ tools, channels, skills
  └─ PostgreSQL + Redis                  └─ memories/
         ▲                                        │
         │ WebSocket / API                       │ scanAgentDirectory()
         ▼                                        ▼
  letta-code harness                       @artificer-ai/runtime
  ├─ 64+ tools                             ├─ role-scoped tools
  ├─ mods, hooks, skills                   ├─ workstream FSM
  ├─ permissions                           ├─ quota / cost tracking
  └─ local filesystem access               └─ channels + HTTP API
                                                   │
                                                   ▼
                                             ~/.artificer/ exec state
                                             ├─ messages, runs
                                             ├─ workstreams
                                             └─ workspace clones
```

| Concern | Letta | Artificer | Winner for coding agents |
|---|---|---|---|
| Memory depth | ⭐⭐⭐⭐⭐ (3-tier + MemFS + archival) | ⭐⭐⭐ (markdown + graph + optional embeddings) | Letta for conversation; Artificer sufficient for coding context |
| Orchestration reliability | ⭐⭐⭐ (model + tool rules) | ⭐⭐⭐⭐⭐ (deterministic FSM) | Artificer |
| Portable identity | ⭐⭐⭐ (MemFS + cloud state) | ⭐⭐⭐⭐⭐ (whole repo) | Artificer |
| Self-host simplicity | ⭐⭐ (needs DB) | ⭐⭐⭐⭐⭐ (files only) | Artificer |
| Multi-surface reach | ⭐⭐⭐⭐⭐ (CLI, desktop, web, 4+ channels) | ⭐⭐⭐⭐ (web, Slack, Discord, GitHub) | Letta (Telegram, desktop app) |
| GitHub-native workflow | ⭐⭐ | ⭐⭐⭐⭐⭐ | Artificer |
| Cost optimization | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Artificer |
| Benchmarking | ⭐⭐ | ⭐⭐⭐⭐⭐ | Artificer |
| Harness extensibility | ⭐⭐⭐⭐⭐ (mods) | ⭐⭐⭐ (define* API) | Letta for power users; Artificer for clarity |
| Onboarding from other agents | ⭐⭐⭐⭐⭐ (trajectory import) | ⭐ | Letta |
| Academic/research foundation | ⭐⭐⭐⭐⭐ | ⭐⭐ | Letta |

---

## Memory Model Deep Dive

### Letta's three tiers

```
┌─────────────────────────────────────────────────────────┐
│  CORE MEMORY (in-context, agent-editable blocks)        │
│  persona · human · custom labels · git-enabled paths    │
├─────────────────────────────────────────────────────────┤
│  RECALL MEMORY (conversation history)                   │
│  Full log in PostgreSQL · conversation_search tool      │
│  Compacted via Summarizer (sliding window, etc.)      │
├─────────────────────────────────────────────────────────┤
│  ARCHIVAL MEMORY (long-term knowledge store)            │
│  Passages in Archives · pgvector semantic search      │
│  Shareable across agents                                │
└─────────────────────────────────────────────────────────┘
```

Compaction is first-class: multiple modes, per-model thresholds, compaction stats returned in API responses, proactive triggering at 90% for some model families.

### Artificer's model

```
┌─────────────────────────────────────────────────────────┐
│  INSTRUCTIONS (in-context, user + agent editable)       │
│  agent/instructions.md · role prompts · signpost hint   │
├─────────────────────────────────────────────────────────┤
│  RUN HISTORY (execution records)                        │
│  runs/<runId>.json — full tool trajectories             │
│  Prior-run digests borrowed into context (microcompact) │
├─────────────────────────────────────────────────────────┤
│  LONG-TERM MEMORY (identity repo markdown)              │
│  identity/memories/*.md — index + graph + embeddings    │
│  Chronicles per workstream · librarian distill → claims │
└─────────────────────────────────────────────────────────┘
```

Context economics: tool result spilling, microcompaction, file cache, `read_tool_result` for spilled output. Memories are **not auto-injected** — the agent must call `query_memories`.

### Synthesis

Artificer's memory model is **simpler and more auditable** (plain files in git). Letta's is **more powerful for agents that live for months** and need to search thousands of past messages semantically. The biggest gap for Artificer is **recall search** over run/message history — not archival pgvector.

---

## Orchestration Deep Dive

### Letta agent loop

```
User message → load AgentState → prepare in-context messages
  → rebuild memory if blocks changed
  → check compaction → summarize if needed
  → LLM call with tools
  → execute tools (core / sandbox / MCP / client)
  → loop until stop (max_steps, send_message, approval)
  → optional sleeptime background agents
  → return response / stream
```

The model decides what happens next. Tool rules constrain but don't dictate workflow.

### Artificer workstream loop

```
Inbound message → communicator LLM
  → start_workstream if coding task
  → stepWorkstream() [deterministic FSM]
      setup → plan (planner LLM) → implement (worker LLM)
      ↔ review (reviewer LLM) → submit PR (worker) → done
  → optional librarian distill on completion
  → reply to user
```

The **code** decides what happens next. LLMs only run for generative steps.

### When each approach wins

| Scenario | Better fit |
|---|---|
| "Fix this bug and open a PR" | Artificer FSM |
| "What did we discuss about the API redesign last month?" | Letta recall search |
| "Be my proactive chief of staff" | Letta (crons, dreaming, open loop) |
| "Run SWE-bench and report cost per task" | Artificer bench |
| "Embed a stateful agent in my SaaS app" | Letta Agent SDK |
| "Clone my agent to a new machine and keep working" | Artificer identity repo |

---

## Strategic Recommendations for Artificer

### Double down (don't let Letta overlap erode differentiation)

1. **Git-versioned whole-agent identity** — the single strongest position; Letta versions memory but not the full agent product
2. **Deterministic SWE state machine** — reliability beats flexibility for autonomous coding
3. **GitHub-native colleague model** — own account, PRs, CI response
4. **Cost engineering + benchmarking** — measure correctness *and* dollars; `artificer eval` on customer identity
5. **Deployment ladder without lock-in** — laptop → Docker → cloud, same identity repo

### Borrow selectively (high ROI)

1. **Trajectory import** — onboard users from Claude Code/Cursor sessions into Artificer memories
2. **Recall search** over run/message history — close the "what did we discuss" gap without PostgreSQL
3. **Structured memory blocks** — persona / user / project split in instructions
4. **Post-turn lightweight distillation** — sleeptime-lite after communicator interactions, not just workstream completion
5. **Bundled operational skills** — teach agents how to maintain their own identity repo
6. **Claude Code compatibility** — permissions + hooks for external executor users

### Avoid

1. PostgreSQL/cloud-state as a requirement
2. Replacing FSM with model-driven orchestration
3. Mods-style runtime self-modification
4. Competing as a general embedded-agent platform (Letta Agent SDK territory)
5. Adopting Letta's "experiential entity" positioning over "autonomous colleague"

---

## Appendix: Key Source Locations

### Letta (legacy server) — `/Users/danielbanks/dev/letta`

| Topic | Path |
|---|---|
| Deprecation notice | `AGENTS.md` |
| Memory schema | `letta/schemas/memory.py` |
| Agent loop | `letta/agents/agent_loop.py`, `letta_agent_v3.py` |
| Core tools | `letta/services/tool_executor/core_tool_executor.py` |
| MCP | `letta/services/mcp_manager.py` |
| Summarizer | `letta/services/summarizer/` |
| Memory repo (MemFS) | `letta/services/memory_repo/` |

### letta-code — `/Users/danielbanks/dev/letta-code`

| Topic | Path |
|---|---|
| Agent identity prompt | `src/agent/prompts/letta.md` |
| Backend abstraction | `src/backend/backend.ts` |
| Tool definitions | `src/tools/tool-definitions.ts` |
| WebSocket listener | `src/websocket/listener/` |
| Trajectory / history import | `src/skills/builtin/initializing-memory/SKILL.md` |
| Mod architecture | `src/skills/builtin/creating-mods/references/architecture.md` |
| Channels | `src/channels/` |

### Artificer — `/Users/danielbanks/dev/artificer`

| Topic | Path |
|---|---|
| Workstream FSM | `packages/runtime/src/engine/workstream-machine.ts` |
| Memory system | `packages/runtime/src/engine/workstream-memory.ts`, `storage/memory-search.ts` |
| Memory guide | `docs/guides/managing-memories.md` |
| Skills API | `packages/runtime/src/api/define-skill.ts` |
| Bench harness | `packages/runtime/bench/` |
| Identity evals design | `docs/superpowers/specs/2026-08-11-identity-agent-evals-design.md` |
| Eve comparison | `docs/research/2026-06-22-eve-comparison.md` |

---

## Conclusion

Letta and Artificer are the two most philosophically aligned projects in the autonomous agent space: both believe agents should persist, learn, and self-modify. The divergence is **problem selection**. Letta optimizes for memory-rich, multi-surface, lifelong agents — a platform play. Artificer optimizes for autonomous software engineering with auditable git identity and deterministic quality gates — a product play.

The smartest path for Artificer is not to become Letta, but to **study Letta's memory craftsmanship** (recall search, distillation cadence, trajectory import, compaction tuning) while **widening the moat** on portable identity, SWE orchestration, GitHub workflow, and cost-aware benchmarking. Where Letta asks "how does the agent remember?", Artificer should ask "how does the agent ship correct code, cheaply, as itself?"
