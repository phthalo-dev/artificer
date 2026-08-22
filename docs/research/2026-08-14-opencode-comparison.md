# Artificer vs. opencode — Comparison (2026-08-14)

> Research conducted 2026-08-14 via five parallel deep-dive passes into `/Users/danielbanks/dev/opencode` (synced locally that day) covering: core agent loop/session/memory, tools/permissions/plugins, client-server/CLI architecture (with a dedicated feasibility check for using opencode as an Artificer `WorkerExecutor`), provider/cost infrastructure, and misc packages/positioning — plus a direct read of Artificer's own `WorkerExecutor` interface (`packages/runtime/src/engine/executor.ts`). File:line references below are from those passes; this doc follows the citation/structure conventions of the existing [Letta comparison](./2026-08-12-letta-comparison-independent.md).

---

## tl;dr

opencode is a **general-purpose, provider-neutral, open-source coding-agent CLI/TUI/desktop app** (MIT-licensed, backed by a commercial hosting layer) built on a genuinely well-engineered event-sourced session/compaction core. It has no fixed role taxonomy — "agents" are user-defined personas with their own model/permission config, switchable mid-session — and, notably, **no long-term or cross-session memory system at all**: context is scoped to a session's compacted message history plus whatever a plugin injects. Its two most distinctive ideas are **codemode** (bounded JS programs that orchestrate multiple tool calls in one turn instead of one-call-per-turn) and a genuinely rich **plugin hook surface** (15+ lifecycle events, closer to Letta's Mods in trust posture but user/config-authored, not agent-self-authored). It explicitly does **not** attempt tool sandboxing (`SECURITY.md` says the permission system is "a UX feature... not designed to provide security isolation") and, surprisingly, has **no cost/budget governance** — token/cost tracking is purely observational, no caps, no tiering — which puts Artificer ahead on that specific dimension.

Most importantly for the second half of this research: **opencode is directly usable today as an Artificer `WorkerExecutor`.** `opencode run "<task>" --format json --auto -m <provider>/<model>` emits a structured NDJSON event stream (tool calls with file paths, text, an explicit idle/error completion signal) that maps cleanly onto Artificer's existing subprocess-executor pattern, and opencode's own CI (`.github/workflows/review.yml`) already uses exactly this invocation shape to review its own PRs — real production precedent, not a hypothetical. There's also a stronger option: `@opencode-ai/sdk` exports the same typed client the CLI uses internally, so an in-process integration (no subprocess, no stdout-scraping) is possible.

---

## What opencode actually is, architecturally

### Session model: event-sourced, not a flat message log

Sessions persist to SQLite via Drizzle (`packages/core/src/database/`) as an **event-sourced** store, not a simple message table. `SessionInput.admit()` (`packages/core/src/session/input.ts:39-72`) publishes a `SessionEvent.PromptAdmitted` with a monotonic `admittedSeq`, and prompts have an explicit admitted→promoted lifecycle — an **inbox pattern** for prompts that arrive while the agent is mid-turn (migration `20260603141458_session_input_inbox.ts`). The message union (`packages/schema/src/session-message.ts:200-213`) has eight tagged types (`user`, `assistant`, `tool`, `system`, `shell`, `synthetic`, `agent-switched`, `model-switched`, `compaction`), and assistant messages carry per-message `snapshot.{start,end,files}` (a workspace snapshot ref) and `tokens.{input,output,reasoning,cache.{read,write}}` — richer per-turn accounting than a flat log.

### Agent loop: queue-drain, not heartbeat-driven

No Letta-style per-tool-call `request_heartbeat`. Instead, `SessionRunCoordinator` (`packages/core/src/session/run-coordinator.ts`) serializes durable work per session key — `run()`/`wake()`/`interrupt()` — and `SessionRunner.run({sessionID, force})` "drains eligible durable work" (`runner/index.ts:21`), architecturally closer to a job queue than ReAct-with-continuation-signal. Step limits are enforced structurally via `MAX_STEPS_PROMPT` (`runner/max-steps.ts`), which hard-disables tools and forces a text-only wrap-up once a ceiling hits — the same spirit as Artificer's `RUNTIME_MAX_ITERATIONS` guardrail, just opencode's version is baked into the runner rather than an env var.

### Memory: a real gap — none found

Grepping `packages/core/src` for memory/recall/long-term turned up nothing relevant. **There is no cross-session recall, no vector/semantic search, no persistent memory store anywhere in core.** Context is exactly: this session's (compacted) event history, a separate per-session "baseline" context snapshot (`SessionContextEpoch`, below), and whatever a plugin injects. This is a real, structural difference from both Letta's MemFS and Artificer's `identity/memories/*.md` + `query_memories` — opencode has nothing to say about "what did we discuss last week."

### Compaction: more structured than Artificer's current digest

`packages/core/src/session/compaction.ts` auto-compacts when estimated request tokens exceed `context - max(output, buffer)` (`DEFAULT_BUFFER = 20_000`), keeps the most recent `DEFAULT_KEEP_TOKENS = 8_000` tokens verbatim, and summarizes everything older via a dedicated LLM call into a **fixed structured Markdown template**: `Objective / Important Details / Work State (Completed/Active/Blocked) / Next Move / Relevant Files` (`SUMMARY_TEMPLATE`, lines 16-46), with explicit merge rules on repeat compactions ("conversation wins," "carry forward unless finished," lines 47-55). Separately, `SessionContextEpoch` (`context-epoch.ts`) tracks a distinct "baseline" project/environment-facts snapshot with its own reconcile logic — two independent mechanisms for two different kinds of context drift, both more structured than Artificer's current prior-run digest.

### "Agents" are freeform personas, not a fixed role taxonomy

`Agent.Info` (`packages/schema/src/agent.ts:26`) is user/config-defined with `mode: "subagent" | "primary" | "all"`, its own model and permission config, and sessions can switch agent mid-session (`agent-switched` message type). This is flatter and more freeform than Artificer's fixed six roles (communicator/orchestrator/planner/reviewer/worker/librarian) or Letta's seven built-in subagent types — closer to "named personas with independent model+permission config" than a structured orchestration hierarchy.

### Tools: registry-based, mid-migration

`packages/opencode/src/tool/tool.ts:55-77` defines tools as `{id, description, parameters: Schema.Decoder, execute(args, ctx)}`, built via `Tool.define()`. Unlike Artificer's filesystem-auto-discovered `agent/tools/*.ts`, this is **registry-based** — built-ins live in flat files wired into a central `registry.ts`. Notably, there's a second, newer Effect-based tool definition surface in `packages/core/src/tool/tool.ts` alongside the older one — the repo is visibly mid-migration between two tool systems. Every tool call gets shared output truncation and OTel spans for free.

### Plugins: broad hook surface, user-authored (not agent-self-authored)

`packages/plugin/src/index.ts:74` — `Plugin = (input, options?) => Promise<Hooks>` with 15+ lifecycle hooks (`config`, `tool`, `auth`, `provider`, `chat.message`, `chat.params`, `chat.headers`, `permission.ask`, `command.execute.before`, `tool.execute.before/after`, `shell.env`, `experimental.chat.system.transform`, `experimental.session.compacting`, `tool.definition`, ...). Plugins are declared in config, resolved/installed like npm packages, and dynamically `import()`ed as **fully trusted JS with no sandboxing** (`packages/opencode/src/plugin/loader.ts`). Trust-posture-wise this sits closer to Letta's Mods than to Artificer's identity-repo-only model — but critically, it's **config-authored by a human, not something the agent writes and hot-reloads itself mid-session** the way Letta explicitly designs Mods for. The hook surface itself (especially `tool.execute.before/after` and `experimental.session.compacting`) is broader than anything Artificer currently exposes to extensions.

### Permissions: rule-based, no named modes, with a clever command-parsing heuristic

No enum of modes (no Claude-Code-style ask/allow/deny, no Letta unrestricted/standard/acceptEdits/strict). Instead, `permission/index.ts:28-38` evaluates the **last matching rule** across config rules + session-approved rules (permission-key wildcard × pattern wildcard), defaulting to `{action: "ask"}`; approvals can widen the live "approved" ruleset (`once`/`always`/`reject`), and a same-session reject cascades to cancel other pending requests. The standout detail: Bash command permission-matching uses a **command-prefix "arity" heuristic** (`permission/arity.ts`) — an LLM-generated dictionary (`git` → 2 tokens, `docker compose` → 3 tokens, etc.) to extract the "human-understandable command" from a full shell invocation, meaningfully more linguistically sophisticated than plain glob-prefix matching.

### Skills and commands: skills are tiered (like Letta), commands are filesystem-convention (like Artificer)

Skills scan global/project/config-specified/"pulled"-external directories for `SKILL.md` files (`skill/index.ts`, `skill/discovery.ts:35`), invoked via a dedicated `skill` tool that requires explicit permission before loading content — structurally close to Letta's tiered-scope skill model. Custom commands, by contrast, are filesystem-convention-based (`{command,commands}/**/*.md`, YAML frontmatter + template body, name from relative path — `config/command.ts:12-36`) — the same shape as Artificer's own convention-based extension points, plus two built-ins (`init`, `review`) and MCP-prompt-sourced commands.

### codemode: the single most novel idea found

`@opencode-ai/codemode` — "Effect-native confined code execution over explicit, schema-described tools." Instead of one tool call per model turn, the model writes a small bounded JS program (no `eval`, no network/fs/module access) that **orchestrates multiple tool calls itself** — sequencing, branching, `Promise.all`-style concurrency (max 8 concurrent), with a budgeted tool-discovery catalog and a `$codemode.search` fallback when the full tool list won't fit the budget. Three host-set knobs only: `timeoutMs`, `maxToolCalls`, `maxOutputBytes`. This is the same shape as Anthropic's "code execution with MCP" pattern, and directly relevant to reducing per-tool-call round-trips in Artificer's orchestrator/tool loop.

### Provider abstraction: generic adapter + baseURL table, not per-backend modules

`packages/llm/src/providers/` has one file per **hosted** provider with real protocol differences (`anthropic.ts`, `openai.ts`, `google.ts`, `amazon-bedrock.ts`, `azure.ts`, `github-copilot.ts`, `cloudflare.ts`, `xai.ts`) layered on shared wire protocols in `packages/llm/src/protocols/`. Everything else routes through one generic `openai-compatible.ts` provider plus `openai-compatible-profile.ts`, which hardcodes baseURL "flavor" presets for `baseten`/`cerebras`/`deepinfra`/`deepseek`/`fireworks`/`groq`/`openrouter`/`togetherai`/`xai`. **Notably, there are no dedicated Ollama/LM Studio/vLLM profiles** — those go through the bare generic adapter with a user-supplied `baseURL`. Directly relevant to Artificer's `feat/open-weights-inference-support` branch: this is a second real-world data point (after Letta's per-backend Python modules) on the "one generic adapter + baseURL table" vs. "per-backend quirk-encoding module" tradeoff, and it argues the per-backend-module approach may be more than local-inference backends actually need.

### Cost/quota: purely observational — opencode is behind Artificer here

Per-message `cost` and `tokens.{input,output,reasoning,cache}` fields exist (`packages/schema/src/session-message.ts:165-189`), and prompt-caching is real and protocol-specific (`packages/llm/src/cache-policy.ts` + per-protocol cache handling with recorded tests). But there is **no budget-cap or quota-enforcement mechanism anywhere** — no per-role cost tiers, no named presets, no daily caps, no multi-route failover across provider accounts (HTTP-level retry/backoff on 429/503/etc. is the only "failover," and it's transport-level, not route-level). `packages/stats/` is a separate public marketing/model-comparison site, not per-user cost accounting. Artificer's role-tier + budget-cap system has no opencode equivalent at all.

### Client/server/CLI split, and headless invocation (the worker-executor question)

The repo currently has **two coexisting CLI codebases**: `packages/cli` is an in-progress "2.0 preview" rewrite with no non-interactive run command yet (its only commands are `api`/`debug`/`migrate`/`service`/`serve`, and the default command just boots the TUI). The actual published, usable CLI is `packages/opencode` (v1.18.18, bin `opencode`) — everything below is from there.

There **is** a client-server split: `opencode serve` / `opencode service start` runs a background HTTP server; `opencode run` can boot an in-process server or `--attach http://host:port` to a remote one. The wire API is OpenAPI-defined (`packages/sdk/openapi.json`) with a typed client (`@opencode-ai/sdk/v2`, `createOpencodeClient`), and events stream via `client.event.subscribe()` (SSE-style).

**Non-interactive invocation is real and production-proven**: `opencode run "<message>" -m <provider>/<model> [--variant ...] [--format json] [--agent ...] [--session|--continue] [--auto|--yolo|--dangerously-skip-permissions]` (`packages/opencode/src/cli/cmd/run.ts:126-260`). opencode's own CI review workflow (`.github/workflows/review.yml:54`) runs exactly `opencode run -m opencode/gpt-5.5 --variant medium "A new pull request has been created..."` — a direct, currently-running precedent for "spawn opencode headlessly against a repo, react to its output."

- `--format json` emits NDJSON events to stdout: `tool_use` (full tool name/args/result, including file paths for edit/write), `text`, `step_start`/`step_finish`, `error`.
- **Completion signal**: the run loop breaks on a `session.status` event with `properties.status.type === "idle"`.
- **Failure signal**: `session.error` events accumulate; `process.exitCode = 1` on any error path.
- **Important gotcha**: `permission.asked` events in non-interactive mode are auto-**rejected** by default — you must pass `--auto` (or `--yolo`/`--dangerously-skip-permissions`) or every guarded tool call silently fails.
- **Embeddable alternative**: `@opencode-ai/sdk` is the *same* client the CLI uses internally — an in-process integration (`createOpencodeClient` → `session.prompt()` → `event.subscribe()`) is possible without shelling out or parsing stdout at all.

---

## What opencode actually is, as a product

**Positioning**: README tagline — *"The open source AI coding agent"* (README.md:10). MIT-licensed, GitHub org `anomalyco`, domain opencode.ai, distributed via 11+ package managers plus a Tauri desktop app for macOS/Windows/Linux. No stated mission beyond the tagline; positioning is implicit in distribution breadth and provider-neutrality (new-provider requests are routed to a separate `models.dev` project — "shouldn't require many if ANY code changes," per `CONTRIBUTING.md`). `CONTRIBUTING.md` gates UI/core-product features behind "design review with the core team" — open to bug fixes/providers/LSP-formatter support, not open governance over product direction.

**Explicit threat model** (`SECURITY.md`): **no sandbox** — "the permission system exists as a UX feature... not designed to provide security isolation," with users explicitly told to use Docker/VM for real isolation. Server mode is opt-in and **unauthenticated by default** without `OPENCODE_SERVER_PASSWORD`. This confirms, from a different angle than the `containers` package (which turned out to be CI build-speedup Docker images, not a tool sandbox — see below), that **opencode has no tool-sandboxing tier at all**, a real gap relative to Letta's three-tier (local subprocess / E2B / Modal) model.

**Business model**: the root repo is the OSS product; `packages/console` (real billing/workspace/customer/payment-method schema — `billing.ts`, `schema/billing.sql`) and `packages/enterprise` (a gated Teams/SSO-flavored SolidStart app, deployed via SST's `Teams` stage) confirm a real hosted/paid commercial layer sits behind the free CLI, similar in shape to Letta's free/self-host-vs-paid-cloud split.

**Misc packages** (one-liners): `identity` is a false lead — just brand/logo assets, no overlap with Artificer's identity-repo concept or Letta's agent-identity. `slack` is a Slack bot that spins up an embedded opencode server per instance. `console`/`stats`/`web` are the hosted-account, analytics, and marketing surfaces respectively. `desktop` is the Tauri wrapper. `function` is a Cloudflare Worker with a Durable-Object session-sync server plus GitHub App auth — likely backs a cloud session-sync/GitHub-integration feature. `http-recorder` and `httpapi-codegen` are test/build infra (HTTP record-replay cassettes; SDK codegen from the Effect `HttpApi`).

---

## Overlap, restated precisely

| Dimension | opencode | Artificer | Real overlap? |
|---|---|---|---|
| Custom commands | Filesystem convention (`command/commands/**/*.md`, YAML frontmatter) | `agent/skills`/config convention | **Yes** — same convention-over-registration shape |
| Skills | Tiered scope (global/project/config/external), `SKILL.md` | `agent/skills/`, `defineSkill()` | Structurally similar; opencode's is closer to Letta's tiered model than Artificer's flat one |
| Compaction | Threshold-triggered, structured Markdown summary template, dual baseline+message tracks | Microcompaction + prior-run digest | Same problem, opencode's mechanism is more structured today |
| Step/iteration guardrails | `MAX_STEPS_PROMPT` hard-disables tools past a ceiling | `RUNTIME_MAX_ITERATIONS` | **Yes**, same concept, opencode's is baked into the runner rather than externally configured |
| Provider-agnostic | Broad hosted-provider list + generic OpenAI-compatible fallback | OpenAI-compatible base URL + role-tier presets | Both provider-agnostic; opencode has more first-party hosted integrations, Artificer has cost-tier sophistication opencode lacks |
| Subagents/roles | Freeform, user-defined "agents" (persona + model + permissions), mid-session switching | Fixed 6 roles, `invoke_call`-based nesting | Same *concept* (scoped sub-persona), different *rigidity* — opencode is configurable, Artificer is structured |
| Extension surface | Plugins (15+ hooks, trusted JS, config-authored) | `defineTool`/`defineChannel`/custom roles (identity-repo, no runtime hooks) | **Overlap in goal, not mechanism** — opencode's plugin hooks reach much deeper into the runtime than anything Artificer exposes |

---

## What is genuinely unique to opencode

1. **codemode** — bounded JS programs that orchestrate multiple tool calls per turn (branching, concurrency up to 8, budgeted tool-discovery), reducing per-tool-call round-trips. Nothing like this exists in Artificer's tool loop today.
2. **A rich, config-authored plugin hook surface** — 15+ lifecycle events including `tool.execute.before/after`, `chat.params`, `experimental.session.compacting` — deeper runtime access than Artificer's identity-repo-only extension model, though notably human/config-authored rather than agent-self-authored (unlike Letta's Mods).
3. **A production-proven headless invocation contract** (`opencode run --format json`, NDJSON events, explicit idle/error completion signals) plus an embeddable SDK (`@opencode-ai/sdk`) exposing the same client the CLI uses internally — a cleaner non-subprocess integration path than either of Artificer's existing external executors offer.
4. **Command-prefix "arity" heuristic** for Bash permission matching — an LLM-derived token-count dictionary, more linguistically aware than glob-prefix matching.
5. **Event-sourced session/prompt-inbox model** with explicit admitted→promoted prompt lifecycle, handling prompts that arrive mid-turn more explicitly than a simple message queue.
6. **Freeform, user-defined agent personas** (model + permissions per agent, mid-session switching) rather than a fixed role taxonomy.
7. **Broad hosted-provider breadth with real protocol-level differentiation** (dedicated Bedrock/Azure/GitHub Copilot/Cloudflare/Gemini wire protocols, not just OpenAI-shaped passthroughs).

## What is genuinely unique to Artificer

1. **Long-term, cross-session memory.** opencode has none — no recall, no semantic search, no persistent store of any kind outside the current (compacted) session. Artificer's `identity/memories/*.md` + `query_memories` + librarian distillation has no opencode counterpart whatsoever.
2. **Cost/quota governance.** Role-tier presets (low/medium/high), named model presets, daily budget caps, ordered multi-route failover across provider accounts — opencode tracks cost per message but enforces nothing. This is a dimension where Artificer is unambiguously more mature.
3. **The whole agent as one portable git repo.** opencode's config/plugins/agents live in project config files, not a single portable identity unit with its own git-sync story the way Artificer's identity repo is designed.
4. **Deterministic, code-driven workflow orchestration.** opencode's `SessionRunCoordinator`/`SessionRunner` drain durable work but don't encode a plan→implement→review→PR state machine the way Artificer's `nextWorkstreamAction()` does — opencode is a general coding-agent loop, not a workflow-with-quality-gates.
5. **Pluggable worker executors as a first-class concern**, including the ability to point Artificer's own orchestration at *opencode itself* (see below) — opencode has no equivalent "delegate my actual coding to a different harness" seam; it *is* the coding agent, not a wrapper that can swap one out.

---

## Ideas worth borrowing — ranked

### Tier 1 — high value, no architectural conflict

**1. codemode-style batched tool orchestration.** Letting the worker/orchestrator loop write a small bounded program to sequence several tool calls (with concurrency) instead of one call per model turn is a direct, mechanism-agnostic win for reducing round-trips on repetitive multi-file tasks. Doesn't require adopting opencode's Effect runtime — the shape (bounded execution, schema-described tool catalog, host-set `timeoutMs`/`maxToolCalls`/`maxOutputBytes` knobs) is portable to Artificer's own tool-use loop.

**2. Structured compaction summary template.** opencode's fixed `Objective / Important Details / Work State / Next Move / Relevant Files` template, with explicit merge rules across repeat compactions, is more disciplined than Artificer's current prior-run digest and cheap to adopt — same idea already flagged in the Letta comparison (model-family-aware thresholds), now reinforced by a second independent implementation.

**3. opencode as a `WorkerExecutor`.** Directly actionable, no architectural conflict: `opencode run --format json --auto` slots into Artificer's existing subprocess-executor pattern (`ClaudeCodeExecutor`/`CursorAgentExecutor`/generic `CliExecutor`) with a cleaner event contract than either existing integration. Worth a real feasibility spike — see dedicated section below.

### Tier 2 — valuable, needs care to fit Artificer's philosophy

**4. Command-prefix "arity" heuristic for permission matching.** If Artificer ever tightens its in-process tool permission model beyond role-scoped access, opencode's token-count dictionary approach to Bash command matching is a concretely better pattern than naive glob-prefix matching — low-risk to adopt narrowly at the permission-evaluation layer without touching anything else.

**5. Freeform per-agent model/permission override, layered on top of (not replacing) fixed roles.** Artificer's six roles are a deliberate, valuable constraint (see "what not to borrow" in the Letta doc), but nothing stops a role from having an optional per-workstream model override the way opencode's `Agent.Info.model` works — smaller, additive version of the idea rather than opencode's fully freeform persona system.

### Tier 3 — interesting but likely not worth it for Artificer's shape

- **A generic plugin hook system reaching into the runtime** (`tool.execute.before/after`, `experimental.session.compacting`) — this is exactly the "identity repo vs. runtime" line Artificer already drew against Letta's Mods in the prior comparison; opencode's plugins are less agent-self-modifying than Mods but still cross the same line Artificer deliberately doesn't cross.
- **Per-provider protocol modules for every hosted backend** — opencode's breadth here is a function of being a general-purpose multi-provider product; Artificer's OpenAI-compatible-base-URL + role-tier approach already covers the practical need without maintaining N provider-specific wire-protocol implementations.
- **Event-sourced session/prompt-inbox model** — genuinely elegant, but solves a problem (concurrent prompt admission mid-turn in an interactive multi-client session) that doesn't really exist in Artificer's workstream-driven, mostly-single-caller execution model.

---

## What Artificer should explicitly not borrow, and why

1. **Trusted, unsandboxed plugin execution as a general extension mechanism.** opencode's own `SECURITY.md` is candid that this is a deliberate, documented tradeoff for a single-user local tool ("run it in Docker/VM if you need isolation"). Artificer's identity-repo model (version-controlled, human-reviewable, never touching the runtime that interprets it) is a stricter, more auditable bar — don't loosen it to match opencode's hook surface.
2. **"No cost governance."** This is a place where opencode is behind, not ahead — nothing to borrow here, if anything it's confirmation that Artificer's role-tier/budget-cap system is worth keeping and extending, not simplifying toward opencode's purely-observational approach.
3. **Two-CLI-codebases-in-flight as a migration pattern.** Not really a "borrowable idea," but worth noting as a caution: opencode is visibly mid-migration between two tool-definition systems and two CLI entrypoints (`packages/cli` 2.0 preview vs. published `packages/opencode`). If Artificer ever undertakes a comparable internal rewrite, don't let both surfaces stay live and partially-featured for an extended period without a clear cutover plan.

---

## opencode as an Artificer `WorkerExecutor` — feasibility

Artificer's `WorkerExecutor` interface (`packages/runtime/src/engine/executor.ts`) is small and stable:

```ts
export interface WorkerExecutor {
  readonly name: string;
  execute(opts: { context: string; workspaceDir: string; run: RunRecord }): Promise<ExecutorResult>;
}
```

Existing implementations (`claude-code-executor.ts`, `cursor-executor.ts`) spawn their CLI with a `--print`-style non-interactive flag, write a local MCP config pointing at Artificer's `artificer-status` MCP server, instruct the CLI (via a prompt suffix) to call `report_status`/`submit_review`, and read back a `.artificer-status.json` file the executor polls after the process exits — plus a timeout+SIGKILL and non-zero-exit-code-rejects-the-run contract. `cli-executor.ts` already generalizes this into a config-driven template (`type: 'cli'` in `artificer.config.json`, documented in `docs/guides/custom-cli-executor.md`) that any CLI matching the same shape can use with zero new code.

**Two viable integration paths, both real (not hypothetical):**

- **(a) Subprocess + NDJSON, matching the existing pattern.** `opencode run "<context>" --format json --auto -m <provider/model>` inside `workspaceDir`, parse the NDJSON stream for `tool_use`/`text`/`step_finish`/`error` events, treat a `session.status: idle` event as completion and any `session.error` (or non-zero exit) as failure. This maps onto the generic `CliExecutor` template directly, or a dedicated `OpencodeExecutor` if bespoke event-stream parsing is worth its own file. opencode's own CI (`.github/workflows/review.yml`) proves this exact invocation shape works unattended in production.
- **(b) In-process SDK integration — stronger, but bigger lift.** `@opencode-ai/sdk`'s `createOpencodeClient` is the same client the CLI uses internally; an executor could start/attach to an `opencode serve` instance directly from Node, call `session.prompt()`, and consume `event.subscribe()` — skipping subprocess spawning and stdout-parsing entirely. This is architecturally cleaner than *both* existing executors (which rely on subprocess + file-based MCP status round-tripping) but is a genuinely new pattern for Artificer's executor layer, not a drop-in fit for the current `WorkerExecutor` shape which assumes a single `execute()` call rather than a live client.

**Open questions for an actual spike** (deliberately not resolved by this research pass, since implementation was out of scope):
- Whether `report_status`/`submit_review`-equivalent structured output can come from opencode's own NDJSON stream (likely — final `text` event + tool-call file paths cover most of `ExecutorResult`'s needs) or whether it still needs the MCP-status-file round-trip Claude Code/Cursor use, which would require opencode's MCP config to be wired at the project-config level rather than passed per-invocation the way `--mcp-config` works for the other two CLIs.
- Whether `--auto` is an acceptable default for Artificer's trust posture, given opencode's explicit "no sandbox, permissions are UX not security" stance (`SECURITY.md`) — Artificer already runs its existing executors with comparably permissive flags (`--dangerously-skip-permissions` for Claude Code, `--yolo` for Cursor), so this is consistent with current practice, but worth confirming deliberately rather than by default.

**Bottom line: feasible, with real precedent, likely a same-day spike using path (a) against the existing `CliExecutor` template** — no blocking architectural mismatch found.

---

## Sources

- `/Users/danielbanks/dev/opencode` — `packages/core/src/{session/{input,run-coordinator,compaction,context-epoch}.ts,tool/tool.ts,agent.ts,database/}`, `packages/opencode/src/{tool/{tool,registry}.ts,plugin/loader.ts,permission/{index,arity}.ts,skill/{index,discovery}.ts,tool/skill.ts,config/command.ts,cli/cmd/run.ts}`, `packages/schema/src/{session-message,agent}.ts`, `packages/plugin/src/index.ts`, `packages/llm/src/{providers/,protocols/,route/executor.ts,cache-policy.ts,openai-compatible{,-profile}.ts}`, `packages/sdk/openapi.json`, `packages/codemode/`, `packages/console/{core/src/billing.ts,schema/billing.sql}`, `packages/enterprise/`, `packages/containers/`, `packages/identity/`, `packages/slack/src/index.ts`, `packages/function/`, `packages/cli/src/commands/`, root `README.md`/`CONTRIBUTING.md`/`SECURITY.md`, `.github/workflows/review.yml`, `github/action.yml`
- `/Users/danielbanks/dev/artificer` — `packages/runtime/src/engine/{executor,claude-code-executor,cursor-executor,cli-executor,engine,provider-router,call,workstream-machine}.ts`, `packages/runtime/src/api/types.ts`, `docs/guides/custom-cli-executor.md`, `docs/research/2026-08-12-letta-comparison-independent.md` (structural/citation model for this doc)
