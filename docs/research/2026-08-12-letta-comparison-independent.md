# Artificer vs. Letta — Independent Comparison (2026-08-12)

> Research conducted 2026-08-12 as an independent pass, before discovering that a prior comparison already exists at [`2026-08-11-letta-comparison.md`](./2026-08-11-letta-comparison.md) (committed 2026-08-11, bundled into an unrelated `evals` commit). This document was produced without reading that one first, from a fresh set of parallel deep-dives into the actual source code of `/Users/danielbanks/dev/letta` (the legacy Python/FastAPI server), `/Users/danielbanks/dev/letta-code` (the current TypeScript harness), Artificer's own `packages/runtime/src/`, and Letta's public docs (docs.letta.com). Where this document's findings diverge from the 2026-08-11 doc, that's called out explicitly in **"Corrections to the existing comparison doc"** below — read that section first if you've already read the other one.
>
> Sourcing note: the Letta-server section below is a hybrid — a dedicated research agent was partway through it when it hit a session rate limit, so the remainder was completed by direct `Read`/`grep`/`find` against `/Users/danielbanks/dev/letta` in this session. File:line references are exact; anything inferred rather than directly read is marked as such.

---

## tl;dr

Letta and Artificer are the two projects in this space that actually agree on the same starting premise: **an agent should be a persistent, memory-owning entity you can return to, not a disposable chat completion.** Both express that as git-tracked, agent-editable memory; both ship skills, subagents/roles, channels (Slack/Discord/…), and a coding-agent CLI. That's where the agreement ends.

**Letta is building a memory-and-continuity *platform*.** Its center of gravity is the memory system (three historical tiers — core/recall/archival — now converging on a git-backed MemFS), a hosted multi-tenant service (Postgres + Redis + pgvector, organizations/users, REST API), and a harness (`letta-code`) that is explicitly a thin client over that service — state lives on the server, the harness is disposable and can run *anywhere* (laptop, cloud sandbox, GitHub Actions, a Mac Mini) and reconnect to the same agent. Its self-modification story (**mods**) is about rewriting the *harness's own runtime behavior* — new tools, commands, hooks, permission policies, even model providers — as trusted local code the agent itself can edit and hot-reload.

**Artificer is building an autonomous-coding-colleague *product*.** Its center of gravity is a deterministic workstream state machine (plan → implement → review → PR, encoded as a pure function, not LLM judgment) wrapped around role-scoped LLM calls, with a single git repo — the *whole agent*, not just its memory — as the unit of portability, and no database at all. Its self-modification story is scoped to the *identity repo*: `defineTool`/`defineChannel`/custom roles, all version-controlled, none of it touching the runtime that executes them.

Both are legitimate, non-competing bets. Letta's harness is a "harness for a memory-and-identity backend"; Artificer's role/orchestrator layer is a "harness for whichever coding agent you point it at" (it can literally delegate the worker role to Claude Code or Cursor as a subprocess). The interesting overlap isn't "who wins" — it's that Letta has clearly iterated much further on the *mechanics* of long-lived memory (recall search, sleep-time consolidation, compaction tuning, trajectory import) than Artificer has, while Artificer has iterated much further on *reliable, auditable coding orchestration* (FSM-driven review gates, cost/quota engineering, integrated SWE-bench harness, pluggable executors) than Letta has.

---

## Corrections to the existing 2026-08-11 comparison doc

If you've already read `docs/research/2026-08-11-letta-comparison.md`, its analysis holds up well overall, but Letta moves fast and a few claims are stale or under-specified as of this pass:

1. **"Letta Cloud — managed backend (Constellation)"** — **Constellation branding was retired.** Letta's own docs (`docs.letta.com/letta-code/constellation`) now exist solely as a migration guide: *"Constellation described where agent state was stored and how it was accessed... it did not specify where the harness or its tools executed."* Old → current: "Constellation agent" → **cloud-hosted agent**; "Constellation login" → **sign in with Letta**; "Constellation sandbox" → **cloud sandbox**. If you see "Constellation" in older Letta discussion, mentally substitute "Letta Cloud."
2. **Permissions table says "allow/deny/ask"** — Letta Code actually has **four modes**: `unrestricted` (default; a.k.a. "yolo"), `standard`, `acceptEdits`, `strict`, cycled with `Shift+Tab` — a close structural mirror of Claude Code's own permission-mode UX (`src/permissions/mode.ts` in letta-code).
3. **"Hooks — Claude Code–compatible lifecycle hooks"** is listed as something Letta has and Artificer lacks — true, but incomplete: Letta Code's own **Hooks are themselves deprecated** in favor of **Mods**' event system (`docs.letta.com/reference/deprecated/hooks`: *"Harness Hooks are deprecated and may be removed in a future release. Use Mods for event-driven runtime customization."*). Hooks (Claude-Code-compatible `PreToolUse`/`PostToolUse`/etc., matched by tool-name regex, command or LLM-prompt handlers, `stdin` JSON payload, exit-code blocking) still exist and still work — but Mods are now the recommended path for new integrations.
4. **Subagents "background agents" framing undersells the implementation.** In letta-code, *every* subagent call — including `fork`, `recall`, and even an agent calling itself — is a **real subprocess**: `spawnSubagent()` shells out to a fresh `letta` CLI child process in headless mode (`letta -p ... --output-format stream-json`), communicating over stdin/stdout NDJSON. This is architecturally distinctive (full process isolation, independent permission modes per subagent, recursive self-spawn is just "spawn the same binary again") and worth calling out on its own, not folded into "background agents."
5. **No mention of Letta's business model / pricing tiers**, which matters for judging whether "borrow this" ideas are cloud-dependent: Free ($0, 3 agents, BYOK only), Pro ($20/mo, quota + overage), API ($20/mo + $0.10/agent/mo + $0.00015/sec tool execution), Teams Pro ($20/seat/mo), Enterprise (custom). Self-hosting (local CLI/desktop with no account, or a self-hosted App Server) is documented purely as a technical path with **no paid tier** — Letta doesn't charge for self-hosting, it just doesn't optimize UX for it (e.g., self-hosted agents can't be accessed via chat.letta.com and aren't auto-backed-up).
6. **The legacy `letta` Python server is more architecturally informative than "deprecated, skip it" suggests.** It's a real multi-tenant service — Postgres + Redis + pgvector, an `Organization`/`User` ORM, sandboxed tool execution across three backends (local subprocess, E2B, Modal), a REST API with both a native v1 surface and an **OpenAI-compatible endpoint**, and — notably — its own `memory` tool has *already* converged on path-based addressing (`memory(agent_state, "str_replace", path="/memories/user_preferences", ...)`) rather than the classic MemGPT `core_memory_append`/`archival_memory_insert` function set, and `ContextWindowOverview` already has a dedicated `memory_filesystem` field (`num_tokens_memory_filesystem`, `memory_filesystem: Optional[str]`, "git-enabled agents only"). In other words, even the "legacy" server has been retrofitted toward MemFS — the classic three-tier core/recall/archival model isn't a clean separate lineage from MemFS, it's the same evolving system.

---

## What Letta actually is, architecturally

### The stack, bottom to top

```
Postgres + Redis + pgvector (self-hosted or Letta Cloud)
  Organizations, Users, Agents, Blocks, Archives, Passages, Groups, Runs, Messages
  Tool sandboxes: local subprocess | E2B | Modal
                          │
                          │  @letta-ai/letta-client (official TS SDK, ^1.10.2)
                          ▼
              letta-code harness (thin client)
  CLI/TUI · Desktop app · chat.letta.com · Slack/Telegram/Discord/WhatsApp/Signal
  Local tool execution (Bash/Read/Edit/...) · Skills · Mods · Permissions · Crons
                          │
                          ▼
              "Environments" — any machine can register as a
              remote listener; agent state stays server-side,
              tool execution happens wherever the listener runs
```

Confirmed directly in code (`/Users/danielbanks/dev/letta-code/src/backend/backend.ts`): `Backend` is an interface where nearly every method is a one-line passthrough to the official SDK client (`getClient()` builds `new Letta({apiKey, baseURL, ...})`). There is **no `@letta-ai/letta-agent-sdk` package anywhere in letta-code's dependency tree** — the harness is built directly on the same low-level client SDK any third-party integrator would use, not on some separate internal-only interface. The "Agent SDK" that Letta's docs point developers toward for *building their own* stateful-agent apps is a distinct, higher-level TypeScript package layered over the same underlying WebSocket protocol that `letta server` exposes.

### Memory: three historical tiers, now unifying into MemFS

- **Core memory** — in-context, agent-editable **blocks** (`persona`, `human`, custom labels), each with a character `limit`, `read_only` flag, and (per `letta/schemas/block.py`) template/versioning fields for shareable persona/human presets across agents.
- **Recall memory** — full conversation history, queried via a `conversation_search` tool (hybrid text + semantic) rather than being reconstructed from raw logs each turn.
- **Archival memory** — long-term "passages" store, semantic search via pgvector, shareable across agents via `Archive`/`archives_agents` join tables in the ORM.
- **MemFS** (the current, harness-default system) — memory represented as actual files in a **real git repository** rooted at `~/.letta/agents/<agent-id>/memory/` (letta-code), with a `system/` directory always compiled into the live system prompt and everything else (`reference/`, `skills/`) loaded progressively. A pre-commit git hook enforces YAML-frontmatter schema on every memory file; commits are synthetic-authored (`<agentId>@letta.com`); pushes to the user's own configured remote happen asynchronously via a post-commit hook.

The `memory` tool itself (`letta/functions/function_sets/base.py:9-68`, legacy server) is already path-addressed — `command: "create"|"str_replace"|"insert"|"delete"|"rename"`, `path="/memories/..."` — which is the same shape as file-tree editing, not classic MemGPT block mutation. The academic MemGPT lineage (`core_memory_append`, `archival_memory_insert`) has been fully superseded in the current function set; `letta/functions/function_sets/builtin.py` today only has `run_code`, `run_code_with_tools`, `web_search`, `fetch_webpage` — the old archival/core-memory function names are gone from the default toolset entirely.

### The agent loop is a real ReAct-style loop with an explicit continuation signal

Confirmed in `letta/agents/letta_agent.py`: every tool call carries a `request_heartbeat` argument (`_pop_heartbeat(tool_args)`); `_decide_continuation()` (line 1878) sets `continue_stepping = request_heartbeat` and layers additional forced-continue conditions on top (tool-rule violations, "child tool" rules, uncalled tools the user is expecting). This is the direct, still-alive descendant of the original MemGPT heartbeat mechanism — a model-controlled "keep going without waiting for the user" signal, now composed with declarative `ToolRule` constraints rather than being the *sole* control mechanism.

### Sleep-time compute is implemented as a multi-agent group, not a cron job

`letta/agents/agent_loop.py` is a factory: when `agent_state.enable_sleeptime` and a `multi_agent_group` exists, it instantiates `SleeptimeMultiAgentV4` (or `V3`) instead of the plain `LettaAgentV2`/`V3`. `SleeptimeMultiAgentV4.step()` (`letta/groups/sleeptime_multi_agent_v4.py:44-79`) runs the normal foreground turn via `super().step(...)`, then unconditionally calls `self.run_sleeptime_agents(...)` afterward — i.e., **every single foreground turn triggers a background consolidation pass**, not just ones that cross a token or step-count threshold. `letta/groups/` also defines `dynamic_multi_agent.py`, `round_robin_multi_agent.py`, and `supervisor_multi_agent.py` — sleep-time is one instance of a general multi-agent "group manager" abstraction (`ManagerType.sleeptime` vs. `.round_robin` vs. `.supervisor` vs. `.dynamic`), and native agent-to-agent messaging tools exist as first-class functions: `send_message_to_agent_and_wait_for_reply`, `send_message_to_agents_matching_tags`, `send_message_to_agent_async` (`letta/functions/function_sets/multi_agent.py`).

letta-code's reflection subagent (the harness-level implementation of the same idea) fires on two configurable triggers (`compaction-event` default, or `step-count` every N assistant steps) rather than every turn, runs in an isolated git worktree, and is scoped to `Bash`+`Edit` only — a more conservative, resource-bounded version of the server-side "every turn" model.

### Portability format: a single `.af` JSON file, not a git repo

`letta/schemas/agent_file.py` defines an `AgentFileSchema` that bundles `AgentState`, `Block`s, `Message`s, `Group`s, `Tool`s, `Source`s, `File`s, and `MCPServer`s into one importable/exportable unit, with human-readable IDs for cross-referencing within the file. This is Letta's answer to "move my agent somewhere else" at the *server* level — distinct from and older than MemFS's git-based portability, and still used by letta-code for packaging subagent definitions and skill bundles (`src/agent/export.ts`).

### Multi-tenant service reality

`letta/orm/` has 35+ tables (`organization.py`, `user.py`, `agent.py`, `block.py`, `block_history.py`, `archive.py`, `conversation.py`, `group.py`, `identity.py`, `message.py`, `provider.py`, `run_metrics.py`, `mcp_server.py`, `mcp_oauth.py`, ...) — this is unambiguously built as a real hosted multi-tenant backend, not a single-user local tool that happens to use a database. `letta/server/rest_api/routers/` has both a native `v1` API and an `openai`-compatible router. Tool execution is sandboxed across three backends (`letta/services/tool_sandbox/{local_sandbox,e2b_sandbox,modal_sandbox_v2}.py`) — meaningfully more isolation than Artificer's "custom tools run in-process, the safety boundary is the code you wrote" model.

### Provider breadth — directly relevant to Artificer's current branch

`letta/schemas/providers/` and `letta/llm_api/` cover: `anthropic`, `azure`, `bedrock`, `deepseek`, `fireworks`, `google_gemini`, `google_vertex`, `groq`, `minimax`, `mistral`, `openai`, `sglang`, `together`, `xai`, `zai`, `chatgpt_oauth`, plus **open-weights/local-inference-specific** providers: `ollama`, `lmstudio`, `vllm`, `cerebras`, `openrouter`, `baseten`. Given Artificer's active branch is `feat/open-weights-inference-support`, Letta's provider abstraction is a directly useful reference: it treats local/self-hosted inference backends (Ollama, LM Studio, vLLM, SGLang) as first-class provider configs alongside hosted APIs, with per-provider schema modules rather than one generic OpenAI-compatible passthrough for everything non-hosted.

---

## What Letta actually is, as a product (from docs.letta.com)

Letta's own words: *"the platform for building stateful agents"* that *"learn from experience and improve with use."* Marketing tagline: *"Machines that learn."* The differentiator is framed explicitly as **persistence as identity**: *"a persistent AI identity with its own memory, model configuration, tools, and message history"* you *"return to... across sessions, computers, and interfaces instead of starting from scratch."* A recurring phrase — *"Context is selfhood"* — positions memory/context management as identity itself, not a feature bullet.

**Product surface**, current naming (docs.letta.com):

| Product | What it is |
|---|---|
| Letta App (desktop + chat.letta.com) | GUI: chat, memory viewer/graph, schedules, channels, skills |
| Letta CLI ("Letta Code") | Terminal coding-agent harness, `npm install -g @letta-ai/letta-code` |
| **Letta Agent SDK** | High-level TS interface over the App Server's WebSocket protocol, for embedding agents in apps; backends: `cloud` / `local` / `remote` |
| **App Server** | Self-hosted runtime exposing that WebSocket protocol (+ OpenAI-compatible API). Docs warn: *"has filesystem and shell access... never expose it directly to untrusted clients"* |
| Letta Cloud | Managed hosting; agent state + optional managed cloud sandbox execution, or BYOM (bring-your-own-machine) |
| Remote Client API | Lower-level hosted transport for people building their own SDK-equivalent; docs explicitly steer typical app builders away from it toward the Agent SDK |
| Legacy V1 SDK/API | The original REST API + client SDKs (`letta-client`); Letta's own docs put it — not the new Agent SDK — "most similar to Claude Agent SDK, Codex SDK, OpenCode SDK" |
| GitHub Action | `@letta-code` mention triggers an agent that can read/edit/PR (not approve PRs or touch workflow files) |

**Skills interoperability claim worth flagging directly**: Letta implements what it calls the "open Agent Skills standard," explicitly claimed to be portable across *"Claude Code, Hermes Agent, and OpenClaw."* letta-code's skill-import path (`SKILL_REPOS` in `src/agent/export.ts`) hardcodes `anthropics/skills/main/skills` as a recognized canonical source alongside Letta's own repos — i.e., Letta explicitly designed for and tests against Anthropic's own skills format, not just a superficially similar one.

**"Computers"** — a deliberately named abstraction distinct from agent identity: *"the agent's identity and memory are separate from the computer, so a signed-in agent can move between environments without losing what it knows."* Three kinds (current/local machine, auto-provisioned cloud sandbox, BYOM), with agents able to "teleport" between them. Explicit stated limitation: *"Moving an agent does not copy a project directory or local secrets to the new computer."*

**Target audience**, stated as co-equal, not ranked: coding agents, personal assistants, "AI coworkers," and stateful agents embedded in third-party applications — one underlying "stateful agent" platform serving all four.

---

## What Artificer actually is, architecturally (for contrast)

(Summarized here for completeness; if you've read Artificer's own docs/`orchestration.md` this will be familiar — included so this document stands alone.)

- **Identity repo** (`IdentityLayout`, `packages/runtime/src/storage/identity-layout.ts`) — one git-trackable directory holding `artificer.config.json`, `agent/instructions.md`, `agent/tools/*.ts`, `agent/channels/*.ts`, `agent/skills/`, `agent/schedules/*.md`, and `identity/memories/*.md` (+ auto-maintained `index.json`/`graph.json`/`embeddings.json`). This is explicitly **the whole agent**, not just its memory — config, tools, channel adapters, and custom roles all live and version inside it, cloneable and runnable anywhere. `IdentityGitSync` auto-commits/pushes on memory writes when configured, serialized through a promise-chain queue.
- **Execution state** is a separate, non-portable concern: `ARTIFICER_EXEC_DIR` (default `~/.artificer/<name>/`) holds runs, workstreams, cloned target-repo workspaces, tool-result spill files, quota ledger — ephemeral, not meant to travel with the agent.
- **Roles are one primitive**: `communicator`, `orchestrator`, `planner`, `reviewer`, `worker`, `librarian`, each just a distinct system prompt + scoped tool set dispatched through the same tool-use loop (`packages/runtime/src/engine/roles.ts`, `role-registry.ts`). Custom roles are new prompt files under `agent/roles/`, registered the same way as built-ins.
- **The `orchestrator` tool** is the single shared primitive every level uses: `get_status` (capped/clipped workstream snapshot), `invoke_call` (spawn a child call — re-invokes the orchestrator automatically when the child finishes), `update_status`, `query_memories`/`add_memory`, `record_finding` (a per-workstream "blackboard" fed back into every subsequent call's context). The orchestrator role itself is stateless-per-invocation and re-entrant, not a long-running loop — nesting is possible because `orchestrator` is itself a spawnable role, though the shipped design mostly uses one flat tree.
- **Memory** is markdown-file-per-entry (`identity/memories/*.md`, YAML frontmatter: `kind` ∈ `note`/`document`/`preference`/`claim`/`entity`), retrieved via `query_memories` (word/tag match, optional local or OpenAI-embedding hybrid, off by default). Deliberately **never auto-injected** — every role gets a passive one-line "signpost" (count + top tags) and must actively call the tool. Workstreams auto-accumulate a capped "chronicle" memory; on completion, a fire-and-forget librarian pass distills 1–5 durable claims/entities from it, deduped by content hash.
- **Deterministic FSM**: `nextWorkstreamAction()` (`workstream-machine.ts`) is a pure function — `pending → planning → reviewing → in_progress → paused_quota/blocked → done/failed/cancelled` — routing is code, not model judgment.
- **Tools/channels** follow the same pattern: `defineTool()`/`defineChannel()` factories, filesystem auto-discovery under `agent/tools/`/`agent/channels/`, no registration step, role-scoped access (e.g. reviewer has no `edit_file`).
- **No database, single process.** Hard operational guardrails are env-var-configured, not left to model judgment: `RUNTIME_CONCURRENCY` (2), `RUNTIME_MAX_ITERATIONS` (24), `RUNTIME_MAX_RUN_MS` (420s), `RUNTIME_MAX_RUNS_PER_WORKSTREAM` (60).
- **Provider-agnostic** via an OpenAI-compatible `LLM_BASE_URL`, with a genuinely distinctive **role-tier + quota/route** system: three cost tiers (low/medium/high) independently configurable per role, named presets, daily budget caps, and ordered failover across execution routes.
- **Executors — the most distinctive, least-Letta-like piece**: `WorkerExecutor` is a pluggable interface letting `planner`/`worker`/`reviewer` delegate to an *external* coding-agent CLI (Claude Code via subprocess + local MCP server, Cursor, or a generic CLI executor) instead of Artificer's own tool loop. Artificer's orchestration/identity/memory layer can sit **on top of** someone else's coding harness for the actual file-editing.

---

## Overlap, restated precisely

| Dimension | Letta | Artificer | Real overlap? |
|---|---|---|---|
| Agent-editable long-term memory as files | MemFS (git-backed) | identity/memories/*.md (git-backed) | **Yes, structurally close** — both landed on "memory is a git-tracked file tree the agent edits with tool calls, not a black-box vector DB" |
| Memory is pull, not push | System-tier files always in context; everything else progressive/on-demand | Signpost only; body pulled via `query_memories` | **Yes** — independent convergence on "don't auto-inject" |
| Skills | 4-tier scope (project/agent/global/bundled), SKILL.md + YAML frontmatter, Claude-Code-compatible | `agent/skills/`, `defineSkill()` | Structurally similar; Letta's is more elaborated (scoping precedence, autonomous authorship via reflection) |
| Subagents/roles | Subprocess-spawned, 7 builtin types, agent-defined via Markdown+frontmatter | In-process role dispatch via `invoke_call`, 6 builtin roles, custom roles via prompt files | Same *concept* (spawn a scoped sub-call), very different *mechanism* (process vs. in-process) |
| Channels | Telegram/Slack/Discord/WhatsApp/Signal/custom, plugin interface | Slack/Discord/web/HTTP, `defineChannel()` | Same shape (adapter interface + access-control layer), Letta has broader first-party coverage |
| Self-modification of extension surface | Mods — rewrite the *harness runtime* (tools, commands, hooks, permissions, providers), trusted local code, hot-reload | `defineTool`/`defineChannel`/custom roles — extend via the *identity repo*, no runtime self-modification | **Overlap in goal, not mechanism** — Letta explicitly allows agents to rewrite their own harness; Artificer explicitly does not |
| Model-agnostic | Broad provider list incl. local/open-weight backends | OpenAI-compatible base URL + role-tier presets | Both provider-agnostic; different axis of sophistication (Letta: breadth of provider integrations; Artificer: cost/tier routing) |
| Self-hosting story | Technically free, UX-optimized for cloud (self-hosted agents lose chat.letta.com access, no auto-backup) | Self-hosting *is* the primary path — Fly.io/Docker/AWS CDK, no cloud offering at all | Divergent, not overlapping |

---

## What is genuinely unique to Letta

1. **Separation of agent state from execution environment, as a first-class, named concept ("computers").** An agent's identity/memory live server-side; *any* machine can become an execution environment by registering as a listener. The same agent can "teleport" between a laptop, a cloud sandbox, and GitHub Actions without losing memory. Artificer co-locates state and execution in one process by design — there's no equivalent "run my agent's tools somewhere else while its memory stays put" primitive.
2. **Sleep-time compute as a structural multi-agent pattern**, not a bolt-on job — it's one `ManagerType` among several (`round_robin`, `supervisor`, `dynamic`, `sleeptime`), and in the server's default config it fires after *every* turn, not on a threshold. Native agent-to-agent messaging tools (`send_message_to_agent_and_wait_for_reply`, etc.) exist independent of the subagent-spawn mechanism.
3. **Mods** — genuine runtime self-modification: an agent can register new tools, override built-in slash commands, hook into 10 lifecycle events (including rewriting an outbound turn or a tool's args/results), install custom permission checks, and even swap the model provider — all as trusted, hot-reloadable local code the agent itself can author. Explicitly not sandboxed, by design (*"mods are for changing the harness itself... trusted local code that the agent can inspect, edit, reload, and repair"*).
4. **Trajectory import** (`@letta-ai/trajectory`) — normalizes session history from Claude Code, Codex, Hermes, OpenHands, and Deep Agents (in addition to letta-code itself) into a common format, used both for onboarding (seed memory from a user's prior sessions elsewhere) and reflection-transcript analysis.
5. **A published portable single-file agent format (`.af`)** at the server level, independent of and older than MemFS's git-based portability — two different, coexisting answers to "move this agent."
6. **Multi-tenant, DB-backed service architecture with three tool-sandboxing tiers** (local subprocess / E2B / Modal) — meaningfully stronger isolation options than Artificer's in-process-with-full-Node-access model.
7. **Deliberate Claude Code interoperability as a design constraint**, not just inspiration — hook types literally commented "Claude Code-compatible" in source, permission rule syntax identical (`Tool(pattern)` glob/prefix matching), a `${CLAUDE_SKILL_DIR}` compatibility shim in the skill loader, and `anthropics/skills` hardcoded as a recognized canonical skill source.
8. **Broad first-party channel coverage** (Telegram, WhatsApp, Signal, Discord, Slack) plus a documented "OpenClaw pattern" for extending the single shared message-channel tool with per-channel actions.
9. **Academic/research lineage as an actual product input**, not just marketing — MemGPT's UC Berkeley origins visibly still shape concrete decisions (per-model-family compaction thresholds, the heartbeat continuation mechanism, the group-manager abstraction for sleep-time).

## What is genuinely unique to Artificer

1. **The whole agent — not just memory — is one portable git repo.** This is the sharpest architectural line between the two projects. Letta versions memory (MemFS) and portable-exports agent config (`.af`), but the harness/runtime that executes an agent is a separate, non-agent-specific piece of software (`letta-code`) talking to a server. Artificer's identity repo *is* the agent: config, custom tools, custom channels, custom roles, and memories, all in one clone-and-run unit, decoupled from any hosting service.
2. **Deterministic, code-driven orchestration for the coding workflow specifically.** `nextWorkstreamAction()` as a pure, unit-testable function is a different bet than Letta's model-driven tool loop (even with `ToolRule` constraints layered on) — Artificer trades flexibility for predictable quality gates on a narrower task (ship correct code via plan→implement→review→PR), which is exactly the kind of workflow where non-determinism is costliest.
3. **Pluggable worker executors** — the ability to delegate the *actual coding* to an external harness (Claude Code, Cursor) while Artificer retains orchestration, review gating, and memory. Letta's harness has no equivalent "swap out who does the typing" seam; letta-code *is* the coding agent.
4. **Cost/quota engineering as first-class infrastructure**: role-tier presets, per-call complexity overrides, named model presets, daily budget caps with reserve percentages, and ordered multi-route failover across provider accounts. Letta has broad provider support but no equivalent named "cheap communicator / expensive planner" system.
5. **No-database, single-process architecture as a deliberate simplicity bet.** Letta's production path assumes Postgres + Redis (+ pgvector for archival search); self-hosting Letta means running that stack (or accepting the App Server's narrower feature set). Artificer's entire state model is files on disk — trivially inspectable, backupable, and reasoned about, at the cost of Letta's semantic-search-over-years-of-history depth.
6. **The identity repo as the sole extension surface, explicitly not the runtime.** This is a real, opinionated tradeoff against Letta's mods: Artificer's contract is "extensions live in version-controlled files the agent (or you) commits to the identity repo; the runtime that interprets them is never itself rewritten." Auditability over runtime flexibility.

---

## Ideas worth borrowing — ranked, with a concrete mechanism sketch

### Tier 1 — high value, no architectural conflict

**1. Recall / history search.** Letta's `conversation_search` fills a real gap: Artificer today has workstream chronicles (task-scoped) and long-term memories (curated), but nothing indexes raw run/message history for "what did we discuss about X three weeks ago" queries that never became a durable memory. This doesn't require Postgres or pgvector — Artificer already has a word/tag matcher (`memory-search.ts`) and an optional embedding hasher (`memory-embeddings.ts`); the same machinery can index run/message excerpts (final assistant text + task description, not full tool trajectories) into a size-capped rolling index under `ARTIFICER_EXEC_DIR`, exposed as a `search_history` tool alongside `query_memories`.

**2. Model-family-aware compaction thresholds.** Letta's summarizer proactively compacts at different thresholds per model family (e.g. earlier for GPT-5-class models). Artificer already has microcompaction and prior-run digests; the missing piece is treating the trigger threshold as a function of the active model rather than a fixed constant — cheap to add, no new infrastructure, directly reduces wasted context/cost.

**3. Structured instruction blocks.** Letta's `persona`/`human` block split (and, more directly, MemFS's `system/`-always-in-context vs. `reference/`-on-demand split) is a cleaner mental model than one flat `agent/instructions.md`. Splitting into `agent/instructions/{persona,user-preferences,project-context}.md`, concatenated in a fixed order, is backward-compatible and gives agents (and the librarian's distillation pass) a clearer place to route new facts.

**4. Trajectory import for onboarding.** This is Letta's single strongest DX idea and Artificer has nothing like it. A user switching from Claude Code or Cursor has months of accumulated preference/workflow signal sitting in their session logs; importing even a conservative subset (explicit "always/never" instructions, stated preferences — not code diffs) into `identity/memories/` as a `dry-run`-then-`apply` CLI step is a meaningful first-session win. `@letta-ai/trajectory` (MIT-licensed, per its npm listing) could plausibly be a devDependency for the parsing step even without adopting anything else from Letta.

### Tier 2 — valuable, needs care to fit Artificer's philosophy

**5. Bundled operational skills.** Letta ships skills like `initializing-memory`, `self-configuration`, `context-doctor` (a self-audit skill that measures the agent's own system-prompt token bloat and memory-file organization quality). Artificer scaffolding new projects with equivalent starter skills ("how to write memories," "how to add a custom tool," "how to tune model presets") is low-risk and directly improves cold-start UX — but author them fresh, don't port Letta's content, since the underlying tools/conventions differ.

**6. A lightweight, post-message (not just post-workstream) distillation pass.** Letta's sleep-time compute runs after every foreground turn; Artificer's librarian distill only fires on workstream completion, so preferences or facts stated in plain conversation (never becoming a workstream) are currently lost. A conservative version — capped cadence (e.g. every N inbound messages), strict "durable vs. ephemeral" filtering modeled on letta-code's reflection-subagent heuristics, fire-and-forget so it never blocks the reply — captures most of the value without adopting Letta's "every single turn" cadence (which would meaningfully increase cost per message).

**7. Claude Code-compatible permission/hook conventions, scoped to the executor boundary.** Artificer already delegates to Claude Code as an executor; adopting Claude-Code-compatible `Tool(pattern)` permission syntax and `PreToolUse`/`PostToolUse` hook semantics *at that boundary* (not as a general runtime-rewriting mechanism à la Mods) would reduce friction for users who already have Claude Code permission configs and want them to carry over.

**8. Provider-config granularity for open-weight/local backends**, directly relevant to the current branch. Rather than one generic OpenAI-compatible base URL, Letta's per-provider schema modules (`ollama.py`, `lmstudio.py`, `vllm.py`, `sglang.py`) each encode that backend's quirks (default ports, model-listing endpoints, auth conventions). Worth a look specifically for `feat/open-weights-inference-support` — not to copy Letta's Python code, but to check whether Artificer's current single-base-URL abstraction is going to need this kind of per-backend specialization as more local backends are added.

### Tier 3 — interesting but likely not worth it for Artificer's shape

- **Multi-agent group manager abstraction** (round-robin, supervisor, dynamic) — Artificer's `invoke_call`-based nesting already covers the practical cases (spawn a scoped child, get results back via re-invocation); a formal "group manager" taxonomy adds ceremony without a clear win for a single-agent-per-identity-repo product.
- **`.af`-style single-file export** — redundant with "the identity repo already is the portable unit"; would be solving a problem Artificer's architecture doesn't have.
- **Three-tier tool sandboxing (E2B/Modal)** — worth watching if Artificer's custom-tool trust model ever becomes a stated concern, but it's infrastructure weight (external sandbox provider integration) disproportionate to the current "you wrote this code" threat model, unless/until Artificer starts running untrusted or marketplace-sourced tools.

---

## What Artificer should explicitly not borrow, and why

1. **Mods.** This is the sharpest philosophical fork between the projects, and it's worth stating plainly rather than as a footnote: Letta's own design rationale for mods is *"the interface is the agent, not a human plugin author"* — mods trade API stability for agent-editable recoverability. Artificer's entire identity-repo model is premised on the opposite bet: extensions are version-controlled, human-reviewable, and never touch the runtime that interprets them. Adding mods would blur exactly the line ("agent config" vs. "platform code") that makes Artificer's git-identity story auditable. If an Artificer agent needs new runtime behavior, the answer should stay "write a `defineTool` and commit it," not "the runtime lets the agent rewrite itself while running."
2. **Server-side, multi-tenant, DB-backed state.** Letta's Postgres+Redis+pgvector stack buys real things (years-of-history semantic search, multi-tenant isolation, shared archival memory across agents) but is a fundamentally different ops posture than "clone a repo, run `artificer dev`." Don't add a database to chase Letta's memory depth — the recall-search idea above gets most of the practical benefit from existing file-based infrastructure.
3. **Model-driven orchestration for the coding workflow.** Letta's tool loop (even constrained by `ToolRule`s) is the right choice for an open-ended personal-assistant/chat agent where the next action genuinely can't be known in advance. It is the wrong choice for "implement this ticket and open a PR," which is exactly why Artificer built a deterministic FSM instead. Don't let Letta-envy erode this.
4. **Subprocess-per-subagent as the default mechanism.** It's architecturally clean (real isolation, independent permission modes) but expensive per-call and adds real operational surface (process lifecycle, stdout NDJSON parsing, retry-on-truncation). Artificer's in-process `invoke_call` dispatch is cheaper and simpler for a single-process, no-daemon runtime; only worth revisiting if Artificer ever needs subagent-level OS sandboxing that in-process execution can't provide.
5. **"Digital people" / experiential-entity positioning.** Letta's marketing (*"machines that learn," "digital people," "context is selfhood"*) is a coherent bet for a personal-assistant/companion product. It would actively work against Artificer's "professional colleague with a GitHub account" framing if adopted wholesale — borrow memory *mechanisms*, not the philosophical wrapper.
6. **Unrestricted-by-default permissions.** letta-code defaults to `unrestricted` mode. An agent that pushes to real git remotes and opens PRs as itself warrants a stricter default posture than a general-purpose personal assistant does — this is a place where Artificer should diverge from Letta's default, not converge toward it.

---

## Sources

- `/Users/danielbanks/dev/letta` — direct `Read`/`grep` of `letta/agents/{agent_loop,letta_agent}.py`, `letta/groups/sleeptime_multi_agent_v4.py`, `letta/functions/function_sets/{base,builtin,multi_agent}.py`, `letta/schemas/{block,memory,agent_file}.py`, `letta/orm/`, `letta/services/tool_sandbox/`, `letta/llm_api/`, `letta/schemas/providers/`, `pyproject.toml`, `conf.yaml`, `scripts/docker-compose.yml`, `.github/workflows/*.yml`
- `/Users/danielbanks/dev/letta-code` — deep-dive research pass covering `src/agent/{memory,memory-filesystem,subagents,personality}.ts`, `src/mods/`, `src/permissions/`, `src/hooks/`, `src/cron/`, `src/channels/`, `src/backend/`, `src/websocket/`, `src/skills/`, root `README.md`/`AGENTS.md`, `hooks/` example scripts
- `docs.letta.com` — homepage, `/agent-sdk`, `/concepts/{stateful-agents,memfs,shared-memory,conversations}`, `/configuration/{memory,skills,subagents,permissions,mods,channels,schedules}`, `/platform/{cli,cloud-agents,computers,desktop-app,remote-client,app-server/quickstart,github-action}`, `/pricing`, `/self-hosting`, `/reference/{faq,terminology,changelog,deprecated/hooks}`, `/letta-code/constellation`, `/guides/get-started/intro/`, `letta.com`, `github.com/letta-ai/letta`
- `/Users/danielbanks/dev/artificer` — `packages/runtime/src/{storage/identity-layout.ts,storage/identity-git-sync.ts,engine/{roles.ts,role-registry.ts,call.ts,executor.ts,workstream-machine.ts},tools/{orchestrator-tool.ts,registry.ts},channels/adapters/}`, `README.md`, `orchestration.md`, `docs/guides/`
